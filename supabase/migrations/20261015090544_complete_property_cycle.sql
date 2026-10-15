-- Preserve revision/ownership checks while allowing a server-validated contact-number edit.
create or replace function public.commit_property_change(
  p_actor uuid, p_action text, p_id text, p_expected_revision bigint, p_row jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  current_row public.properties%rowtype;
  next_row public.properties%rowtype;
begin
  select * into actor from public.profiles where id = p_actor for share;
  if not found or actor.suspended or actor.role::text not in ('agent', 'admin', 'owner') then
    raise exception '매물을 관리할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action not in ('create', 'edit', 'verify') or p_action is null then
    raise exception '잘못된 작업입니다.' using errcode = '22023';
  end if;
  if p_action = 'verify' and actor.role::text not in ('admin', 'owner') then
    raise exception '운영진만 승인할 수 있습니다.' using errcode = '42501';
  end if;
  if p_action <> 'create' then
    select * into current_row from public.properties where id = p_id for update;
    if not found then raise exception '매물을 찾을 수 없습니다.' using errcode = 'P0002'; end if;
    if actor.role::text = 'agent' and current_row.created_by is distinct from p_actor then
      raise exception '자신의 매물만 수정할 수 있습니다.' using errcode = '42501';
    end if;
    if current_row.revision is distinct from p_expected_revision then
      raise exception '매물이 변경되었습니다. 새로고침 후 다시 확인해주세요.' using errcode = '40001';
    end if;
  end if;
  next_row := jsonb_populate_record(current_row, coalesce(p_row, '{}'::jsonb));
  next_row.id := p_id;
  next_row.created_by := case when p_action = 'create' then p_actor else current_row.created_by end;
  next_row.verified := p_action = 'verify' and coalesce((p_row ->> 'verified')::boolean, false);
  next_row.last_verified_at := case when next_row.verified then current_date else null end;
  if next_row.price is null or next_row.price <= 0 or next_row.area is null or next_row.area <= 0 then
    raise exception '가격과 면적은 양수여야 합니다.' using errcode = '22023';
  end if;
  if p_action = 'create' then
    next_row.created_at := now();
    next_row.updated_at := now();
    next_row.revision := 1;
    next_row.urgent_score := 0;
    next_row.agent := coalesce(next_row.agent, '{}'::jsonb);
    next_row.lifestyle := coalesce(next_row.lifestyle, '{}'::jsonb);
    next_row.price_history := coalesce(next_row.price_history, '[]'::jsonb);
    next_row.media := coalesce(next_row.media, '[]'::jsonb);
    insert into public.properties select next_row.* returning * into current_row;
  else
    update public.properties set
      title = next_row.title, price = next_row.price, floor = next_row.floor,
      direction = next_row.direction, occupancy_status = next_row.occupancy_status,
      rooms = next_row.rooms, bathrooms = next_row.bathrooms, parking = next_row.parking,
      description = next_row.description, media = next_row.media, agent = next_row.agent,
      actual_transaction_price = next_row.actual_transaction_price,
      discount_rate = next_row.discount_rate, price_basis = next_row.price_basis,
      verified = next_row.verified, last_verified_at = next_row.last_verified_at
    where id = p_id returning * into current_row;
  end if;
  return jsonb_build_object('id', current_row.id, 'revision', current_row.revision, 'verified', current_row.verified);
end $$;
revoke all on function public.commit_property_change(uuid, text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_property_change(uuid, text, text, bigint, jsonb) to service_role;


-- Count only public listings, and exclude owners even after an email change.
create or replace function public.track_property_event(p_property_id text, p_event text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text;
  v_owner uuid;
  v_suspended boolean;
  v_role public.app_role;
  v_email text;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_event is null or p_event not in ('view', 'inquiry_tel', 'inquiry_email') then
    return false;
  end if;

  -- 있는 매물만 센다 — 아무 id 나 받으면 행을 끝없이 늘릴 수 있다
  select nullif(lower(trim(agent ->> 'email')), ''), created_by into v_agent, v_owner
  from public.properties
  where id = p_property_id and verified = true for share;
  if not found then
    return false;
  end if;

  -- 운영진(검수)과 담당 중개사 본인(등록 확인)의 조회는 방문이 아니다
  if auth.uid() is not null then
    select role, lower(trim(email)), suspended into v_role, v_email, v_suspended
    from public.profiles
    where id = auth.uid();
    if not found or v_suspended or auth.uid() = v_owner or v_role in ('admin'::public.app_role, 'owner'::public.app_role) then
      return false;
    end if;
    if v_agent is not null and v_email = v_agent then
      return false;
    end if;
  end if;

  insert into public.property_daily_stats (property_id, day, agent_email, views, inquiry_tel, inquiry_email)
  values (
    p_property_id, v_day, v_agent,
    (p_event = 'view')::int, (p_event = 'inquiry_tel')::int, (p_event = 'inquiry_email')::int
  )
  on conflict (property_id, day) do update
  set views = public.property_daily_stats.views + excluded.views,
      inquiry_tel = public.property_daily_stats.inquiry_tel + excluded.inquiry_tel,
      inquiry_email = public.property_daily_stats.inquiry_email + excluded.inquiry_email,
      agent_email = coalesce(excluded.agent_email, public.property_daily_stats.agent_email);
  return true;
end;
$$;

revoke all on function public.track_property_event(text, text) from public;
grant execute on function public.track_property_event(text, text) to anon, authenticated;

