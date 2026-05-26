/*
 * agent_applications 의 SELECT/UPDATE 정책에 owner 추가.
 * (옛 정책은 admin 만 — owner 가 신청서를 못 보던 문제 fix)
 */

drop policy if exists "Admins can read agent applications" on public.agent_applications;
create policy "Admins can read agent applications"
on public.agent_applications
for select
to authenticated
using (public.current_user_role() in ('admin'::public.app_role, 'owner'::public.app_role));

drop policy if exists "Admins can update agent applications" on public.agent_applications;
create policy "Admins can update agent applications"
on public.agent_applications
for update
to authenticated
using (public.current_user_role() in ('admin'::public.app_role, 'owner'::public.app_role))
with check (public.current_user_role() in ('admin'::public.app_role, 'owner'::public.app_role));
