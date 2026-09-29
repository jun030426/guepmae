/*
 * backtest-report.mjs — 백테스트 결과(JSON) → 한국어 요약 문서(Markdown).
 *
 * 숫자를 옮겨 적기만 한다. 해석·권고는 넣지 않는다 — "눈여겨볼 점"도 두 숫자의 차이를 그대로 적은 것이다.
 * 지표 정의: docs/superpowers/specs/2026-09-29-backtest-design.md §5
 */

const VARIANT_LABELS = {
  current: '운영 규칙',
  no_floor: '층 보정 없음',
  all_36: '36개월 전체 중앙값',
  include_direct: '직거래 포함',
  calendar_anchor: '기준월 = 달력 기준',
};

const int = (n) => (n == null ? '–' : Number(n).toLocaleString('ko-KR'));
const pct = (v) => (v == null ? '–' : `${Number(v).toFixed(1)}%`);
const signed = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const point = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%p`);

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function accuracyRows(items) {
  return items.map((item) => [
    item.key,
    int(item.judged),
    pct(item.accuracy.medianAbsError),
    pct(item.accuracy.within5),
    pct(item.accuracy.within10),
    signed(item.accuracy.bias),
    pct(item.flag.flagRate),
    `${pct(item.flag.precision)} (${int(item.flag.scored)}건)`,
  ]);
}

const ACCURACY_HEADERS = ['구분', '판정 건수', '오차 중앙값', '±5% 이내', '±10% 이내', '치우침', '급매 비율', '정밀도 (채점)'];

/** 두 묶음의 오차 중앙값 차이를 한 줄로. 어느 쪽이든 표본이 없으면 null */
function compare(label, a, b, aName, bName) {
  if (a?.accuracy?.medianAbsError == null || b?.accuracy?.medianAbsError == null) return null;
  const diff = Math.round((b.accuracy.medianAbsError - a.accuracy.medianAbsError) * 10) / 10;
  return `- ${label}: ${aName} ${pct(a.accuracy.medianAbsError)} ↔ ${bName} ${pct(b.accuracy.medianAbsError)} (차이 ${point(diff)})`;
}

export function renderMarkdown(report) {
  const { meta, universe, variants, current } = report;
  const now = variants.current;
  const find = (items, key) => items.find((item) => item.key === key);
  const out = [];

  out.push('# 판정 규칙 백테스트 결과');
  out.push('');
  out.push(`생성일 ${meta.generatedAt} · 데이터 ${meta.dataFrom}~${meta.dataTo} · 검증 대상 ${meta.testFrom}~${meta.testTo}`
    + (meta.filter ? ` · 지역 ${meta.filter}` : '') + (meta.input ? ` · 입력 \`${meta.input}\`` : ''));
  out.push('');
  if (meta.subset) {
    out.push('> **⚠ 일부 단지만으로 돌린 결과다.** 전체 산출물이 없어 번들(거래 많은 상위 단지)을 썼다. 거래가 활발한 단지 쪽으로 치우쳐 있어 전체를 대표하지 않는다.');
    out.push('');
  }
  const dealing = universe.dealing ?? { brokered: 0, direct: 0, unknown: 0 };
  const dealingKnown = dealing.brokered + dealing.direct;
  if (universe.trades > 0 && dealingKnown === 0) {
    out.push('> **⚠ 거래유형(중개/직거래) 정보가 없는 데이터다.** 직거래를 걸러내지 못했다 — 가상 매물과 기준가에 직거래가 섞여 있다. 거래유형은 재수집한 데이터에만 있다.');
    out.push('');
  }
  out.push('과거 실거래 한 건을 "그 달에 그 가격으로 나온 매물"로 보고, **그 달보다 앞선 거래만으로** 기준가를 구해 채점했다.');
  out.push(`급매 판정은 그 달부터 ${meta.options.horizonMonths}개월 동안의 같은 단지·면적·층 구간 거래 중앙값(이후 시세)으로 채점했다.`);
  out.push('기준가 계산은 운영 코드(`computePriceBasis`)를 그대로 호출했다. 이 문서는 과거 데이터의 기록이며 가격 예측이 아니다.');
  out.push('');

  out.push('## 1. 요약');
  out.push('');
  out.push(table(['항목', '값'], [
    ['가상 매물', `${int(universe.tested)}건 (직거래 ${int(universe.skippedDirect)}건은 대상에서 제외)`],
    ['단지', `${int(universe.complexesTested)}곳 (데이터 전체 ${int(universe.complexes)}곳 · 거래 ${int(universe.trades)}건)`],
    ['거래유형', `중개 ${int(dealing.brokered)}건 · 직거래 ${int(dealing.direct)}건 · 미상 ${int(dealing.unknown)}건`],
    ['판정 가능', `${pct(now.coverage)} — 보류: 표본 부족 ${int(now.held.lowSample)}건 · 데이터 없음 ${int(now.held.noData)}건`],
    ['기준가 오차 중앙값', pct(now.accuracy.medianAbsError)],
    ['실제 거래가가 기준가 ±5% 이내', pct(now.accuracy.within5)],
    ['실제 거래가가 기준가 ±10% 이내', pct(now.accuracy.within10)],
    ['치우침', `${signed(now.accuracy.bias)} (+ 는 실제 거래가가 기준가보다 높음)`],
    ['오차 40% 초과', pct(now.accuracy.outlierShare)],
    ['판정 급매', `${int(now.flag.flagged)}건 (판정 가능한 것의 ${pct(now.flag.flagRate)}) · 40% 초과 ${int(now.flag.outliers)}건은 이상치로 제외`],
    ['정밀도', `${pct(now.flag.precision)} — 판정 급매 중 이후 시세보다 ${meta.rule.minDiscount}% 이상 쌌던 비율 (채점 ${int(now.flag.scored)}건)`],
    ['느슨한 정밀도', `${pct(now.flag.loosePrecision)} — 이후 시세보다 조금이라도 쌌던 비율`],
    ['재현율', `${pct(now.flag.recall)} — 이후 시세보다 ${meta.rule.minDiscount}% 이상 쌌던 거래 중 판정이 잡아낸 비율`],
    ['실현 할인율 중앙값', `판정 급매 ${signed(now.flag.medianRealized)} · 그 밖 ${signed(now.flag.medianRealizedUnflagged)}`],
    ['이후 시세를 구할 수 있던 비율', pct(now.outcomeShare)],
  ]));
  out.push('');
  // 위 숫자를 말로 옮긴 것 — 새로운 주장은 없다
  const per100 = (v) => Math.round(v);
  if (now.accuracy.medianAbsError != null) {
    out.push(`- 거래의 절반은 실제 거래가가 기준가에서 ${pct(now.accuracy.medianAbsError)} 안쪽이었다.`);
  }
  if (now.flag.precision != null) {
    out.push(`- 급매로 판정된 거래 100건 중 ${per100(now.flag.precision)}건이 이후 시세로 봐도 ${meta.rule.minDiscount}% 이상 쌌고, ${per100(now.flag.loosePrecision)}건이 이후 시세보다 쌌다.`);
  }
  if (now.flag.recall != null) {
    out.push(`- 이후 시세로 ${meta.rule.minDiscount}% 이상 쌌던 거래 100건 중 ${per100(now.flag.recall)}건을 판정이 잡아냈다.`);
  }
  out.push('');

  out.push('## 2. 규칙 요소별 효과');
  out.push('');
  out.push('같은 가상 매물을 규칙만 바꿔 채점했다. 이후 시세의 정의는 모든 줄에서 같다.');
  out.push('');
  out.push(table(
    ['규칙', '판정 가능', '오차 중앙값', '±5% 이내', '±10% 이내', '치우침', '급매 비율', '정밀도', '재현율'],
    Object.entries(variants).map(([name, v]) => [
      VARIANT_LABELS[name] ?? name,
      pct(v.coverage),
      pct(v.accuracy.medianAbsError),
      pct(v.accuracy.within5),
      pct(v.accuracy.within10),
      signed(v.accuracy.bias),
      pct(v.flag.flagRate),
      pct(v.flag.precision),
      pct(v.flag.recall),
    ]),
  ));
  out.push('');

  out.push('## 3. 판정 할인율과 실현 할인율');
  out.push('');
  out.push('판정이 맞다면 판정 할인율이 큰 구간일수록 실현 할인율도 커야 한다.');
  out.push('');
  out.push(table(
    ['판정 할인율(%)', '채점 건수', '실현 할인율 중앙값', '이후 시세보다 쌌던 비율', `${meta.rule.minDiscount}% 이상 쌌던 비율`],
    current.byDiscountBucket.map((b) => [b.key, int(b.n), signed(b.medianRealized), pct(b.cheaperShare), pct(b.bargainShare)]),
  ));
  out.push('');
  out.push(`급매 기준을 바꿨을 때 (실제 급매의 정의는 "이후 시세보다 ${meta.rule.minDiscount}% 이상"으로 고정):`);
  out.push('');
  out.push(table(
    ['급매 기준', '해당 건수', '채점 대상 중 비율', '정밀도', '느슨한 정밀도', '실현 할인율 중앙값'],
    current.byThreshold.map((t) => [
      `${t.threshold}% 이상${t.threshold === meta.rule.minDiscount ? ' (운영)' : ''}`,
      int(t.flagged), pct(t.flagShare), pct(t.precision), pct(t.loosePrecision), signed(t.medianRealized),
    ]),
  ));
  out.push('');

  out.push('## 4. 세부 (운영 규칙)');
  out.push('');
  const sections = [
    ['4.1 기간 창', '기준가에 쓰인 기간. 최근 12개월 표본이 3건 이상이면 12개월, 아니면 24, 36개월.', current.byWindow],
    ['4.2 층 구간', '같은 층 구간 거래가 3건 이상일 때만 그 거래로 좁힌다.', current.byFloor],
    ['4.3 표본 수', '기준가 산출에 쓰인 거래 수.', current.bySample],
    ['4.4 기준월 경과', '기준월(단지의 가장 최근 거래월)이 가상 매물의 전달보다 몇 달 앞서 있었는가. 거래가 뜸한 단지일수록 길다.', current.byStaleness],
    ['4.5 시도', '판정 건수가 많은 순.', current.bySido],
    ['4.6 분기', '치우침의 부호가 그 분기의 시장 방향이다.', current.byQuarter],
  ];
  for (const [title, note, items] of sections) {
    out.push(`### ${title}`);
    out.push('');
    out.push(note);
    out.push('');
    out.push(items.length ? table(ACCURACY_HEADERS, accuracyRows(items)) : '해당 거래 없음.');
    out.push('');
  }

  out.push('## 5. 눈여겨볼 점');
  out.push('');
  out.push('두 숫자의 차이를 그대로 적었다. 차이가 + 면 뒤쪽의 오차가 더 크다.');
  out.push('');
  const notes = [
    compare('층 구간 보정', variants.current, variants.no_floor, '운영', '층 보정 없음'),
    compare('기간 창', variants.current, variants.all_36, '운영', '36개월 전체'),
    compare('직거래 제외', variants.current, variants.include_direct, '운영', '직거래 포함'),
    compare('기준월', variants.current, variants.calendar_anchor, '단지 최근 거래월(운영)', '달력 기준'),
    compare('표본 수', find(current.bySample, '10건 이상'), find(current.bySample, '3~4건'), '10건 이상', '3~4건'),
    compare('기준월 경과', find(current.byStaleness, '0개월'), find(current.byStaleness, '7개월 이상'), '0개월', '7개월 이상'),
  ].filter(Boolean);
  out.push(notes.length ? notes.join('\n') : '비교할 표본이 없다.');
  out.push('');

  out.push('## 6. 지표 정의');
  out.push('');
  out.push('- 오차 = (실제 거래가 − 기준가) / 기준가. 오차 중앙값은 절댓값의 중앙값, 치우침은 부호를 둔 중앙값.');
  out.push(`- 판정 급매 = 할인율 ${meta.rule.minDiscount}% 이상 ${meta.rule.maxDiscount}% 이하. 할인율 = (기준가 − 거래가) / 기준가.`);
  out.push(`- 이후 시세 = 그 달부터 ${meta.options.horizonMonths}개월, 같은 단지·같은 면적, 직거래 제외, 자신 제외 거래의 중앙값. 층을 아는 매물은 같은 층 구간 거래만 본다(모자라도 전체 층으로 넓히지 않는다). ${meta.options.minFutureSample}건 미만이면 채점에서 빠진다.`);
  out.push('- 실현 할인율 = (이후 시세 − 거래가) / 이후 시세.');
  out.push(`- 검증 대상 = 데이터 첫 달에서 ${meta.options.minHistoryMonths}개월 뒤부터, 이후 ${meta.options.horizonMonths}개월을 볼 수 있는 달까지.`);
  out.push('');

  out.push('## 7. 한계');
  out.push('');
  out.push('- **호가가 아니라 체결가다.** 팔리지 않은 매물의 호가는 볼 수 없다. 실제 매물의 급매 비율은 이 결과와 다를 수 있다.');
  out.push('- 이후 시세를 구할 수 없는 거래(거래가 뜸한 단지)는 채점에서 빠진다. 정밀도·재현율은 거래가 활발한 단지 쪽으로 치우친다.');
  out.push('- 해제 거래는 최종 상태 기준으로 빠져 있다. 당시에는 유효해 보였을 거래도 포함되지 않는다.');
  out.push(`- 36개월 창은 이력(최소 ${meta.options.minHistoryMonths}개월)이 모자라 일부만 검증된다. 보류 비율은 운영보다 조금 높게 나온다.`);
  out.push('- 단지 최고층은 관측된 거래의 최고 층이다.');
  out.push('- 거래 1건이 1표다. 큰 단지가 결과를 더 많이 좌우한다.');
  out.push('');
  return out.join('\n');
}
