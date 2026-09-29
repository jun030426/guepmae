#!/usr/bin/env python
# 자동 수집 워크플로 리허설 — .github/workflows/daily-trades-refresh.yml 의 run 단계를
# 실제 키·실제 API·실제 Supabase·실제 원격 저장소 없이 처음부터 끝까지 돌려 본다.
#
#   국토부 API   → pysite/sitecustomize.py (urllib 가로채기)
#   Supabase     → fake-supabase.mjs (Storage·PostgREST 흉내, 메모리)
#   원격 저장소   → 임시 폴더의 bare git 저장소
#   실거래 원본   → gen-base.mjs 가 번들을 본떠 만든 가짜 CSV
#
# 사용 (Windows 는 Git Bash 에서):  python scripts/rehearsal/rehearse.py [--keep] [--verbose]
# 필요: Python 3 + PyYAML(pip install pyyaml) · Node · git · bash
# 확인하지 못하는 것: uses 단계(checkout·setup-*), npm ci, 실제 러너(Ubuntu), 실제 API·Supabase 의 응답.
import argparse, io, json, os, re, shutil, stat, subprocess, sys, tempfile, time, urllib.request

import yaml

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORKFLOW = ".github/workflows/daily-trades-refresh.yml"
KEY = "rehearsal-service-key"
AGENT_ID = "gm-agent000001"
fwd = lambda p: os.path.abspath(p).replace("\\", "/")


def remove_tree(path):
    """git 이 만든 읽기 전용 파일(.git/objects)은 Windows 에서 그냥은 지워지지 않는다 — 풀고 다시 지운다."""
    def retry(func, target, _exc):
        os.chmod(target, stat.S_IWRITE)
        func(target)
    if not os.path.exists(path):
        return
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=retry)
    else:
        shutil.rmtree(path, onerror=retry)


# ───────────────────────── 워크플로 러너 (GitHub Actions 의 최소 흉내) ─────────────────────────

def find_bash():
    override = os.environ.get("REHEARSAL_BASH")
    if override:
        return override
    if os.name == "nt":
        for candidate in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe"):
            if os.path.exists(candidate):
                return candidate
    found = shutil.which("bash")
    if not found:
        sys.exit("bash 를 찾지 못했습니다 — Git Bash 를 설치하거나 REHEARSAL_BASH 로 경로를 알려주세요.")
    return found


def render(expr, ctx):
    """job env 의 ${{ a || 'b' }} — secrets.X, vars.X, github.event_name, github.event.inputs.X, 문자열 리터럴만."""
    def value(token):
        token = token.strip()
        if token.startswith("'") and token.endswith("'"):
            return token[1:-1]
        if token.startswith("secrets."):
            return ctx["secrets"].get(token[8:], "")
        if token.startswith("vars."):
            return ctx["vars"].get(token[5:], "")
        if token == "github.event_name":
            return "workflow_dispatch" if ctx["event"] == "dispatch" else ctx["event"]
        if token.startswith("github.event.inputs."):
            return ctx["inputs"].get(token[20:], "")
        raise ValueError(f"리허설 러너가 모르는 식: {token}")
    def one(match):
        for part in match.group(1).split("||"):
            v = value(part)
            if v:
                return v
        return ""
    return re.sub(r"\$\{\{(.*?)\}\}", one, str(expr))


def evaluate(cond, steps, env, job_failed):
    """단계 if — 상태 함수가 없으면 success() && (조건) 으로 본다 (GitHub 과 같음)."""
    if cond is None:
        return not job_failed
    has_status = any(f in cond for f in ("always()", "failure()", "success()"))
    expr = (cond.replace("always()", "True").replace("success()", str(not job_failed))
            .replace("failure()", str(job_failed)))
    def lookup(match):
        parts = match.group(0).split(".")
        if parts[0] == "steps":
            step = steps.get(parts[1], {})
            if parts[2] == "outputs":
                return repr(step.get("outputs", {}).get(parts[3], ""))
            return repr(step.get(parts[2], ""))
        return repr(env.get(parts[1], ""))
    expr = re.sub(r"\b(?:steps|env)\.[A-Za-z0-9_.\-]+", lookup, expr)
    expr = expr.replace("&&", " and ").replace("||", " or ")
    result = bool(eval(expr, {"__builtins__": {}}, {}))
    return result if has_status else (result and not job_failed)


class Run:
    def __init__(self):
        self.job = "success"
        self.steps = {}      # 이름 → conclusion
        self.outputs = {}    # id → {k: v}
        self.log = ""

    def conclusion(self, fragment):
        for name, value in self.steps.items():
            if fragment in name:
                return value
        raise KeyError(fragment)


def run_workflow(repo, temp, *, event, inputs, secrets, variables, extra_env, skip=("의존성 설치",), verbose=False):
    wf = yaml.safe_load(io.open(os.path.join(repo, WORKFLOW), encoding="utf-8"))
    triggers = wf.get(True, wf.get("on"))  # PyYAML 은 on: 을 True 로 읽는다
    resolved = {}
    if event == "dispatch":
        for name, spec in (triggers["workflow_dispatch"].get("inputs") or {}).items():
            default = spec.get("default", "")
            resolved[name] = str(default).lower() if isinstance(default, bool) else str(default)
        resolved.update(inputs)
    ctx = {"secrets": secrets, "inputs": resolved, "vars": variables, "event": event}
    job = next(iter(wf["jobs"].values()))

    remove_tree(temp)
    os.makedirs(temp)
    bash = find_bash()
    env = dict(os.environ)
    path_head = [os.path.dirname(sys.executable)]
    if os.name == "nt":
        git_root = os.path.dirname(os.path.dirname(bash))
        path_head += [os.path.join(git_root, "usr", "bin"), os.path.join(git_root, "mingw64", "bin")]
    env["PATH"] = os.pathsep.join(path_head + [env.get("PATH", "")])
    env.update({k: render(v, ctx) for k, v in (job.get("env") or {}).items()})
    env.update({"RUNNER_TEMP": fwd(temp), "GITHUB_REF_NAME": "main",
                "GITHUB_STEP_SUMMARY": fwd(os.path.join(temp, "summary.md")), "CI": "true"})
    env.update(extra_env)
    open(env["GITHUB_STEP_SUMMARY"], "w").close()

    run, steps, failed = Run(), {}, False
    for index, step in enumerate(job["steps"]):
        name = step.get("name") or step.get("uses")
        sid = step.get("id")
        conclusion, outputs = "skipped", {}
        if evaluate(step.get("if"), steps, env, failed):
            if "uses" in step or any(s in name for s in skip):
                conclusion = "success"  # 리허설에서는 하지 않는다
            else:
                out_path = os.path.join(temp, f"output-{index}.txt")
                open(out_path, "w").close()
                script = os.path.join(temp, f"step-{index}.sh")
                with io.open(script, "w", encoding="utf-8", newline="\n") as f:
                    f.write(step["run"])
                proc = subprocess.run([bash, "-e", fwd(script)], cwd=repo,
                                      env=dict(env, GITHUB_OUTPUT=fwd(out_path)),
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                text = proc.stdout.decode("utf-8", "replace")
                run.log += f"\n▶ {name}\n{text}"
                if verbose:
                    print(f"\n▶ {name}\n{text}", flush=True)
                for line in io.open(out_path, encoding="utf-8").read().splitlines():
                    if "=" in line:
                        k, v = line.split("=", 1)
                        outputs[k] = v
                conclusion = "success" if proc.returncode == 0 else "failure"
                failed = failed or proc.returncode != 0
        if sid:
            steps[sid] = {"outputs": outputs, "conclusion": conclusion, "outcome": conclusion}
            run.outputs[sid] = outputs
        run.steps[name] = conclusion
    run.job = "failure" if failed else "success"
    return run


# ───────────────────────── 가짜 Supabase ─────────────────────────

class FakeSupabase:
    def __init__(self, work):
        port_file = os.path.join(work, "port.txt")
        self.proc = subprocess.Popen(["node", os.path.join(HERE, "fake-supabase.mjs"), port_file, KEY],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        for _ in range(100):
            if os.path.exists(port_file) and os.path.getsize(port_file) > 0:
                break
            time.sleep(0.1)
        else:
            sys.exit("가짜 Supabase 서버가 뜨지 않았습니다.")
        self.url = "http://127.0.0.1:" + open(port_file).read().strip()

    def _call(self, path, data=None, method=None):
        req = urllib.request.Request(self.url + path, data=data, method=method or ("POST" if data is not None else "GET"))
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read()

    def state(self): return json.loads(self._call("/__state"))
    def rows(self, table): return json.loads(self._call(f"/__rows/{table}"))
    def meta(self): return json.loads(self._call("/__object/pipeline-data/trades/_meta.json"))
    def reset_log(self): self._call("/__reset-log", b"")
    def clear(self, table): self._call(f"/__clear/{table}", b"")
    def seed(self, table, rows): self._call(f"/__seed/{table}", json.dumps(rows).encode("utf-8"))

    def stop(self):
        try: self._call("/__stop", b"")
        except Exception: pass
        try: self.proc.wait(timeout=5)
        except Exception: self.proc.kill()


# ───────────────────────── 준비 ─────────────────────────

def sh(args, cwd, env=None, check=True):
    proc = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    text = proc.stdout.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        sys.exit(f"명령 실패: {' '.join(map(str, args))}\n{text}")
    return text


def git(cwd, *args, check=True):
    return sh(["git", *args], cwd, check=check)


def setup(work):
    origin, sim = os.path.join(work, "origin.git"), os.path.join(work, "sim")
    git(work, "init", "-q", "--bare", "-b", "main", origin)
    git(work, "init", "-q", "-b", "main", sim)
    # 커밋될 내용만 복사: 추적 파일 + 무시되지 않은 새 파일
    listing = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=REPO,
                             stdout=subprocess.PIPE, check=True).stdout.decode("utf-8")
    for rel in filter(None, listing.split("\0")):
        src = os.path.join(REPO, rel)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(sim, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
    for module in ("iconv-lite", "csv-parse", "safer-buffer"):
        source = os.path.join(REPO, "node_modules", module)
        if not os.path.isdir(source):
            sys.exit(f"node_modules/{module} 이 없습니다 — 먼저 npm install 을 실행하세요.")
        shutil.copytree(source, os.path.join(sim, "node_modules", module))
    for k, v in (("user.name", "rehearsal"), ("user.email", "rehearsal@example.invalid"), ("core.autocrlf", "false")):
        git(sim, "config", k, v)
    git(sim, "add", "-A")
    git(sim, "commit", "-qm", "rehearsal: working tree snapshot")
    git(sim, "remote", "add", "origin", fwd(origin))
    git(sim, "push", "-q", "origin", "main")
    print("  " + sh(["node", os.path.join(HERE, "gen-base.mjs"), sim, os.path.join(work, "truth")], REPO).strip())
    sh(["node", os.path.join(HERE, "gen-base.mjs"), sim, os.path.join(work, "truth-flat"), "--flatten", "0.3"], REPO)
    return origin, sim


def clean_runner(sim):
    """러너는 매번 빈 디스크에서 시작한다 — 이전 실행의 산출물을 지운다."""
    for rel in ("scripts/data", "scripts/output"):
        remove_tree(os.path.join(sim, rel))
    for rel in (".env.local", "src/data/marketData.json", "src/data/complexLookup.json"):
        if os.path.exists(os.path.join(sim, rel)):
            os.remove(os.path.join(sim, rel))
    git(sim, "checkout", "-q", "--", ".")
    git(sim, "clean", "-qfd", "--", "public")


def bootstrap(sim, truth, server):
    """데스크톱에서 하는 일: 원본 CSV 를 버킷에 올린다."""
    data = os.path.join(sim, "scripts", "data")
    remove_tree(data)
    shutil.copytree(truth, data)
    env = dict(os.environ, SUPABASE_URL=server.url, SUPABASE_SERVICE_ROLE_KEY=KEY)
    sh(["node", "scripts/pipeline-data-sync.mjs", "upload"], sim, env=env)


# ───────────────────────── 시나리오 ─────────────────────────

def main():
    ap = argparse.ArgumentParser(description="자동 수집 워크플로 리허설")
    ap.add_argument("--keep", action="store_true", help="임시 폴더를 지우지 않는다")
    ap.add_argument("--verbose", action="store_true", help="단계 출력을 모두 보여준다")
    args = ap.parse_args()

    work = tempfile.mkdtemp(prefix="geupmae-rehearsal-")
    print(f"리허설 폴더: {work}")
    origin, sim = setup(work)
    server = FakeSupabase(work)
    secrets = {"MOLIT_API_KEY": "rehearsal+molit/key==", "SUPABASE_URL": server.url, "SUPABASE_SERVICE_ROLE_KEY": KEY}
    calls_log = os.path.join(work, "molit-calls.txt")
    results = []

    def check(scenario, name, passed, detail=""):
        results.append((scenario, name, bool(passed)))
        print(f"    {'✓' if passed else '✗'} {name}" + (f" — {detail}" if detail and not passed else ""))

    def run(title, *, mode="normal", truth="truth", event="schedule", inputs=None, with_secrets=True, enabled=True):
        print(f"\n{title}")
        clean_runner(sim)
        server.reset_log()
        if os.path.exists(calls_log):
            os.remove(calls_log)
        extra = {"PYTHONPATH": fwd(os.path.join(HERE, "pysite")), "FAKE_MOLIT_TRUTH": fwd(os.path.join(work, truth)),
                 "FAKE_MOLIT_CODES": fwd(os.path.join(sim, "scripts", "_sigungu_codes.json")),
                 "FAKE_MOLIT_MODE": mode, "FAKE_MOLIT_LOG": fwd(calls_log)}
        result = run_workflow(sim, os.path.join(work, "rt"), event=event, inputs=inputs or {},
                              secrets=secrets if with_secrets else {},
                              variables={"TRADES_REFRESH_ENABLED": "true"} if enabled else {},
                              extra_env=extra, verbose=args.verbose)
        for line in result.log.splitlines():
            if line.startswith("::"):
                print("    " + line)
        return result

    def writes():
        return server.state()["log"]

    def seed_db():
        """가짜 DB 를 운영 중 상태로: 현재 번들의 복제본 + 중개사가 포털에서 등록한 매물 1건."""
        server.clear("properties")
        bundle = json.load(io.open(os.path.join(sim, "public", "data", "properties.json"), encoding="utf-8"))
        server.seed("properties", bundle + [{"id": AGENT_ID, "title": "중개사 등록 매물 전용84㎡",
                                             "region": "서울특별시 강남구", "price": 900000000, "discount_rate": None}])
        return bundle

    def verify_db(scenario, before):
        after = json.load(io.open(os.path.join(sim, "public", "data", "properties.json"), encoding="utf-8"))
        db = {r["id"]: r for r in server.rows("properties")}
        kept = {r["id"] for r in after}
        dropped = [r["id"] for r in before if r["id"] not in kept]
        print(f"    번들 {len(before)} → {len(after)}건 (탈락 {len(dropped)}) · DB {len(db)}행")
        check(scenario, "중개사 등록 매물이 남아 있다", AGENT_ID in db)
        check(scenario, "새 번들의 모든 매물이 DB 에 있다", all(i in db for i in kept))
        check(scenario, "탈락한 매물은 DB 에서 지워졌다", not any(i in db for i in dropped))
        check(scenario, "DB 행 수 = 새 번들 + 중개사 매물 1", len(db) == len(after) + 1)
        check(scenario, "DB 의 판정 근거가 새 번들과 같다",
              all(db[r["id"]].get("price_basis") == r.get("price_basis") for r in after if r["id"] in db))
        return after

    origin_head = lambda: git(origin, "rev-parse", "main").strip()
    publish = {"dry_run": "false", "publish_bundles": "true"}

    try:
        s = "A"
        r = run("A. 시크릿 없음 (예약 실행)", with_secrets=False)
        check(s, "실패하지 않는다", r.job == "success")
        check(s, "나머지 단계를 모두 건너뛴다", all(v == "skipped" for n, v in r.steps.items() if "시크릿 확인" not in n))

        s = "A2"
        r = run("A2. 시크릿은 있지만 예약 실행을 아직 켜지 않음", enabled=False)
        check(s, "실패하지 않는다", r.job == "success")
        check(s, "나머지 단계를 모두 건너뛴다", all(v == "skipped" for n, v in r.steps.items() if "시크릿 확인" not in n))
        check(s, "Supabase 에 접속하지 않는다", server.state()["log"] == [])

        s = "B"
        r = run("B. 시크릿은 있지만 버킷이 비어 있음")
        check(s, "실패하지 않는다", r.job == "success")
        check(s, "수집을 건너뛴다", r.outputs["download"].get("ready") == "false" and r.conclusion("증분 수집") == "skipped")

        print("\n부트스트랩 (데스크톱에서 하는 일: 원본 올리기)")
        bootstrap(sim, os.path.join(work, "truth"), server)
        meta0 = server.meta()
        check("부트스트랩", "시도 17개 + 메타가 버킷에 있다", len(server.state()["objects"]) == 18 and len(meta0["perFile"]) == 17)

        s = "C"
        r = run("C. 첫 수동 실행 — dry_run 켬 (예약 실행은 아직 꺼 둔 상태)", event="dispatch", enabled=False)
        calls = [l.split("\t") for l in io.open(calls_log, encoding="utf-8").read().splitlines()]
        months = sorted({c[1] for c in calls})
        codes = json.load(io.open(os.path.join(sim, "scripts", "_sigungu_codes.json"), encoding="utf-8"))
        check(s, "성공", r.job == "success", r.log[-800:])
        check(s, "API 호출 = 시군구 수 × 3개월", len(calls) == len(codes) * 3, f"{len(calls)}회, {months}")
        check(s, "이번 달은 받지 않는다", len(months) == 3 and months[-1] < time.strftime("%Y%m", time.gmtime()), str(months))
        check(s, "Supabase 에 아무것도 쓰지 않는다", writes() == [] and r.conclusion("원본 CSV 올리기") == "skipped")

        s = "D"
        r = run("D. 매일 실행 (예약)")
        rows_out = json.load(io.open(os.path.join(sim, "scripts", "output", "complex_trades_rows.json"), encoding="utf-8"))
        meta1 = server.meta()
        check(s, "성공", r.job == "success", r.log[-800:])
        check(s, "complex_trades 행 수 = 집계 산출물", server.state()["tables"].get("complex_trades") == len(rows_out))
        check(s, "지우지 않고 upsert 만 한다", not any(w["method"] == "DELETE" for w in writes()))
        check(s, "원본 17개 + 메타를 올린다", sum(1 for w in writes() if "storage" in w["path"]) == 18)
        check(s, "신고 지연분이 반영돼 행이 늘었다", meta1["totalRows"] > meta0["totalRows"],
              f"{meta0['totalRows']} → {meta1['totalRows']}")

        s = "D2"
        r = run("D2. 다시 실행 — 행이 중복되지 않는다")
        check(s, "성공", r.job == "success", r.log[-800:])
        check(s, "원본 행 수 그대로", server.meta()["totalRows"] == meta1["totalRows"])
        check(s, "complex_trades 행 수 그대로", server.state()["tables"].get("complex_trades") == len(rows_out))

        s = "E"
        sejong = "api_세종특별자치시.csv"
        r = run("E. 세종 API 장애 (정상 응답 · 0건)", mode="outage:세종특별자치시")
        check(s, "경고만 남기고 계속한다", r.job == "success" and "::warning::신규 0건인 시도 1곳" in r.log, r.log[-800:])
        check(s, "세종의 기존 이력이 그대로다", server.meta()["perFile"][sejong] == meta1["perFile"][sejong])

        s = "L"
        r = run("L. 일일 한도 — 300번째 호출 뒤 한도 초과", mode="limit:300")
        check(s, "경고만 남기고 받은 데까지 반영한다", r.job == "success" and "일일 한도 도달" in r.log, r.log[-800:])
        check(s, "행이 줄지 않는다", server.meta()["totalRows"] >= meta1["totalRows"])

        s = "H"
        meta_before = server.meta()
        r = run("H. 경기도 응답이 1/10 로 줄어듦", mode="shrink:경기도")
        check(s, "행 수 점검에서 멈춘다", r.job == "failure" and r.conclusion("행 수 점검") == "failure", r.log[-800:])
        check(s, "아무것도 올리지 않는다", writes() == [] and server.meta() == meta_before)

        s = "K"
        r = run("K. API 키 오류 (모든 호출 거부)", mode="keyerror")
        check(s, "수집 단계에서 실패로 끝난다", r.job == "failure" and r.conclusion("증분 수집") == "failure", r.log[-800:])
        check(s, "아무것도 올리지 않는다", writes() == [] and server.meta() == meta_before)

        s = "M"
        r = run("M. months 입력이 숫자가 아님", event="dispatch", inputs={"months": "abc", "dry_run": "false"})
        check(s, "수집 전에 멈춘다", r.job == "failure" and not os.path.exists(calls_log))

        s = "F"
        start = git(sim, "rev-parse", "HEAD").strip()
        before = seed_db()
        head0 = origin_head()
        r = run("F. 번들 갱신 (publish_bundles)", event="dispatch", inputs=publish)
        check(s, "성공", r.job == "success", r.log[-1500:])
        verify_db(s, before)
        changed = git(origin, "show", "--name-only", "--format=%an", "main").split()
        check(s, "봇 커밋 1개가 원격에 올라갔다", origin_head() != head0 and changed[0] == "github-actions[bot]")
        check(s, "커밋은 public/data 만 건드린다", all(f.startswith("public/data/") for f in changed[1:]), str(changed))
        check(s, "properties 를 통째로 지우지 않는다",
              not any(w["method"] == "DELETE" and w["path"].startswith("properties?id=neq") for w in writes()))

        s = "N"
        before = json.load(io.open(os.path.join(sim, "public", "data", "properties.json"), encoding="utf-8"))
        head1 = origin_head()
        r = run("N. 바로 다시 실행 — 바뀐 것이 없으면 커밋하지 않는다", event="dispatch", inputs=publish)
        check(s, "성공", r.job == "success", r.log[-1500:])
        check(s, "원격 main 그대로", origin_head() == head1)
        verify_db(s, before)

        s = "I"
        git(sim, "reset", "-q", "--hard", start)
        git(sim, "push", "-q", "-f", "origin", "main")
        other = os.path.join(work, "other")
        git(work, "clone", "-q", fwd(origin), other)
        with io.open(os.path.join(other, "README.md"), "a", encoding="utf-8", newline="\n") as f:
            f.write("\nrehearsal change\n")
        git(other, "-c", "user.name=dev", "-c", "user.email=dev@example.invalid", "commit", "-qam", "docs: 다른 곳에서 올린 커밋")
        git(other, "push", "-q", "origin", "main")
        before = seed_db()
        r = run("I. 실행 중에 main 이 앞서 감 (다른 곳에서 푸시)", event="dispatch", inputs=publish)
        authors = git(origin, "log", "--format=%an", "-2", "main").split("\n")[:2]
        check(s, "성공", r.job == "success", r.log[-1500:])
        check(s, "다른 곳의 커밋 위에 봇 커밋이 얹힌다", authors == ["github-actions[bot]", "dev"], str(authors))
        check(s, "다른 곳의 변경이 보존된다", "rehearsal change" in git(origin, "show", "main:README.md"))
        verify_db(s, before)

        s = "G"
        git(sim, "fetch", "-q", "origin")
        git(sim, "reset", "-q", "--hard", start)
        git(sim, "push", "-q", "-f", "origin", "main")
        bootstrap(sim, os.path.join(work, "truth-flat"), server)
        before = seed_db()
        head2 = origin_head()
        r = run("G. 매물 30% 의 실거래가 호가 수준으로 내려옴 → 10% 넘게 탈락", truth="truth-flat",
                event="dispatch", inputs=publish)
        db = {row["id"] for row in server.rows("properties")}
        check(s, "재계산에서 멈춘다", r.job == "failure" and r.conclusion("번들 재생성") == "failure"
              and "허용치(10%)" in r.log, r.log[-1500:])
        check(s, "번들을 커밋하지 않는다", r.conclusion("번들 커밋") == "skipped" and origin_head() == head2)
        check(s, "DB 의 매물이 그대로다", db == {row["id"] for row in before} | {AGENT_ID})
    finally:
        server.stop()
        if args.keep:
            print(f"\n임시 폴더를 남겨 둡니다: {work}")
        else:
            remove_tree(work)

    failed = [r for r in results if not r[2]]
    print(f"\n리허설 결과: 확인 {len(results)}개 중 {len(results) - len(failed)}개 통과" + (f", {len(failed)}개 실패" if failed else ""))
    for scenario, name, _ in failed:
        print(f"  ✗ [{scenario}] {name}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
