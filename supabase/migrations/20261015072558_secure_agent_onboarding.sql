-- Verified applicants own their submissions. Reviews grant access atomically.
alter table public.agent_applications
  add column user_id uuid references public.profiles(id) on delete set null,
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column reviewed_at timestamptz;
update public.agent_applications a set user_id = p.id
from public.profiles p where lower(btrim(a.contact_email)) = lower(btrim(p.email));
create unique index agent_applications_active_user_idx on public.agent_applications(user_id)
where status in ('pending','reviewing','approved');

revoke insert, update, delete on public.agent_applications from anon, authenticated;
grant select on public.agent_applications to authenticated;
drop policy if exists "Anyone can create agent applications" on public.agent_applications;
drop policy if exists "Admins can update agent applications" on public.agent_applications;
drop policy if exists "Users can read own agent application" on public.agent_applications;
create policy "Users can read own agent application" on public.agent_applications
for select to authenticated using (user_id = (select auth.uid()) and (select public.current_user_role()) is not null);

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.submit_agent_application(p_id uuid, p_details jsonb, p_documents jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  existing public.agent_applications;
  verified_email text;
  doc jsonb;
  field text;
begin
  select * into actor from public.profiles where id = auth.uid() for update;
  if not found or actor.suspended or actor.role::text <> 'user' then
    raise exception '로그인한 일반회원만 중개사 신청을 제출할 수 있습니다.' using errcode = '42501';
  end if;
  select email into verified_email from auth.users where id = actor.id and email_confirmed_at is not null;
  if coalesce(verified_email,'') = '' then
    raise exception '이메일 인증을 먼저 완료해주세요.' using errcode = '42501';
  end if;
  select * into existing from public.agent_applications where user_id = actor.id
    and status in ('pending','reviewing','approved') limit 1;
  if found then
    return jsonb_build_object('id',existing.id,'status',existing.status,'alreadySubmitted',true);
  end if;
  if p_id is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception '신청 정보를 확인해주세요.' using errcode = '22023';
  end if;
  foreach field in array array['office_name','office_registration_number','representative_name','representative_phone'] loop
    if coalesce(length(btrim(p_details->>field)),0) not between 1 and 200 then
      raise exception '필수 신청 정보를 확인해주세요.' using errcode = '22023';
    end if;
  end loop;
  if length(coalesce(p_details->>'office_address','')) > 500 or length(coalesce(p_details->>'contact_phone','')) > 40 then
    raise exception '입력 내용이 너무 깁니다.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' then
    raise exception '사업자등록증과 중개사 자격 서류를 첨부해주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_documents) <> 2 or
     (select count(distinct value->>'label') from jsonb_array_elements(p_documents)
      where value->>'label' in ('business-registration','broker-license')) <> 2 then
    raise exception '두 종류의 서류를 각각 첨부해주세요.' using errcode = '22023';
  end if;
  for doc in select value from jsonb_array_elements(p_documents) loop
    if coalesce(doc->>'path','') not like actor.id::text || '/' || p_id::text || '/%'
       or position('..' in doc->>'path') > 0
       or not exists(select 1 from storage.objects where bucket_id = 'agent-application-documents' and name = doc->>'path') then
      raise exception '본인 계정으로 업로드한 서류만 제출할 수 있습니다.' using errcode = '42501';
    end if;
  end loop;
  insert into public.agent_applications(id,user_id,office_name,office_registration_number,office_address,
    representative_name,representative_phone,contact_email,contact_phone,document_paths)
  values(p_id,actor.id,btrim(p_details->>'office_name'),btrim(p_details->>'office_registration_number'),
    nullif(btrim(p_details->>'office_address'),''),btrim(p_details->>'representative_name'),
    btrim(p_details->>'representative_phone'),verified_email,nullif(btrim(p_details->>'contact_phone'),''),p_documents);
  return jsonb_build_object('id',p_id,'status','pending','alreadySubmitted',false);
end;
$$;

create function private.review_agent_application(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  applicant public.profiles;
  application public.agent_applications;
  applicant_id uuid;
begin
  select * into actor from public.profiles where id = auth.uid() for share;
  if not found or actor.suspended or actor.role::text not in ('admin','owner') then
    raise exception '운영진만 신청서를 처리할 수 있습니다.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('approved','rejected') or length(coalesce(p_note,'')) > 2000 then
    raise exception '검토 상태와 사유를 확인해주세요.' using errcode = '22023';
  end if;
  select user_id into applicant_id from public.agent_applications where id = p_id;
  if not found then raise exception '신청서를 찾을 수 없습니다.' using errcode = 'P0002'; end if;
  if applicant_id = actor.id then raise exception '본인 신청서를 승인할 수 없습니다.' using errcode = '42501'; end if;
  -- Lock in the same profile -> application order used by submission.
  select * into applicant from public.profiles where id = applicant_id for update;
  select * into application from public.agent_applications where id = p_id for update;
  if application.status not in ('pending','reviewing') then
    raise exception '이미 처리된 신청서입니다. 목록을 새로고침해주세요.' using errcode = '40001';
  end if;
  if p_status = 'approved' then
    if applicant.id is null or applicant.suspended or applicant.role::text not in ('user','agent')
      or not exists(select 1 from auth.users where id = applicant.id and email_confirmed_at is not null) then
      raise exception '이메일 인증과 신청자 계정 상태를 확인해주세요.' using errcode = '42501';
    end if;
    update public.profiles set role = 'agent', updated_at = now() where id = applicant.id;
  end if;
  update public.agent_applications set status = p_status, reviewer_note = nullif(btrim(p_note),''),
    reviewed_by = actor.id, reviewed_at = now() where id = p_id;
  return jsonb_build_object('id',p_id,'status',p_status,'profileUpdated',p_status = 'approved',
    'message',case when p_status = 'approved' then '승인 완료 — 중개사 권한이 함께 부여되었습니다.' else '신청이 반려되었습니다.' end);
end;
$$;

revoke all on function private.submit_agent_application(uuid,jsonb,jsonb) from public, anon;
revoke all on function private.review_agent_application(uuid,text,text) from public, anon;
grant execute on function private.submit_agent_application(uuid,jsonb,jsonb) to authenticated;
grant execute on function private.review_agent_application(uuid,text,text) to authenticated;
create function public.submit_agent_application(p_id uuid,p_details jsonb,p_documents jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.submit_agent_application(p_id,p_details,p_documents);
$$;
create function public.review_agent_application(p_id uuid,p_status text,p_note text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.review_agent_application(p_id,p_status,p_note);
$$;
revoke all on function public.submit_agent_application(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.review_agent_application(uuid,text,text) from public, anon;
grant execute on function public.submit_agent_application(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.review_agent_application(uuid,text,text) to authenticated;

drop policy if exists "Public can upload pending agent application documents" on storage.objects;
drop policy if exists "Admins can read agent application documents" on storage.objects;
create policy "Applicants upload own documents" on storage.objects for insert to authenticated
with check(bucket_id = 'agent-application-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_user_role())::text = 'user');
create policy "Applicants and reviewers read documents" on storage.objects for select to authenticated
using(bucket_id = 'agent-application-documents' and (
  (select public.current_user_role())::text in ('admin','owner') or
  ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.current_user_role()) is not null)));
create policy "Applicants remove unattached documents" on storage.objects for delete to authenticated
using(bucket_id = 'agent-application-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_user_role()) is not null
  and not exists(select 1 from public.agent_applications a
    where a.user_id = (select auth.uid()) and a.document_paths @> jsonb_build_array(jsonb_build_object('path',name))));
