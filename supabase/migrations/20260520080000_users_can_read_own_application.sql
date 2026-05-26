/*
 * 사용자가 자기 자신의 agent_application 조회 가능 (이메일 매칭).
 * 운영 관리 페이지의 "승인 대기 중" 상태를 본인에게 표시하기 위함.
 */

drop policy if exists "Users can read own agent application" on public.agent_applications;
create policy "Users can read own agent application"
on public.agent_applications
for select
to authenticated
using (
  contact_email = (select email from public.profiles where id = auth.uid())
);
