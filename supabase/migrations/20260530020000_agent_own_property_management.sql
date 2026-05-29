/*
 * 중개사(agent)는 "자신이 등록한 매물"만 수정/삭제 가능하도록 RLS 조정.
 *
 * 기존 "Agents can insert properties" 의 UPDATE 정책은 모든 agent 가 모든 매물을
 * 수정할 수 있었음 → 본인(agent.email = 로그인 이메일) 매물로 제한.
 * DELETE 는 agent 정책이 없었음 → 본인 매물 삭제 정책 추가.
 *
 * admin/owner 는 20260520090000 의 "Admin or Owner can update/delete" 로 전체 가능(유지).
 */

-- UPDATE: 본인이 등록한 매물만
drop policy if exists "Agents can update properties" on public.properties;
drop policy if exists "Agents can update own properties" on public.properties;
create policy "Agents can update own properties"
on public.properties
for update
to authenticated
using (
  agent->>'email' = (select email from public.profiles where id = auth.uid())
)
with check (
  agent->>'email' = (select email from public.profiles where id = auth.uid())
);

-- DELETE: 본인이 등록한 매물만
drop policy if exists "Agents can delete own properties" on public.properties;
create policy "Agents can delete own properties"
on public.properties
for delete
to authenticated
using (
  agent->>'email' = (select email from public.profiles where id = auth.uid())
);
