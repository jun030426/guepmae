-- Respect the project safe-update extension using explicit market-data key predicates.
create or replace function public.publish_market_dataset(p_run uuid, p_manifest jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_kind text;
  actual bigint;
  previous bigint;
  source jsonb := p_manifest->'source';
begin
  perform pg_advisory_xact_lock(hashtext('guepmae:market-publish'));
  if (source->>'months')::int is distinct from 36
    or (source->>'completedPairs')::int is distinct from (source->>'expectedPairs')::int
    or (source->>'expectedPairs')::int is distinct from (select count(*) * 36 from jsonb_object_keys(source->'districts'))
    or source->'failures' is distinct from '[]'::jsonb
    or source->'missingRegionMonths' is distinct from '[]'::jsonb
    or coalesce((source->>'rows')::bigint, 0) <= 0 then
    raise exception 'Incomplete collection' using errcode = '22023';
  end if;
  -- Do not allow a delayed job to replace a newer successfully published run.
  if exists (select 1 from public.market_snapshots where key='metadata'
      and (data->>'generatedAt')::timestamptz > (source->>'collectedAt')::timestamptz) then
    raise exception 'A newer dataset is already published' using errcode = '22023';
  end if;
  foreach v_kind in array array['complex_trades','complex_prices','price_trends','market_snapshots'] loop
    select count(*) into actual from public.market_import_rows r where r.run_id=p_run and r.kind=v_kind;
    if actual = 0 or actual is distinct from (p_manifest->'tables'->v_kind->>'rows')::bigint then
      raise exception 'Incomplete staging: %', v_kind using errcode = '22023';
    end if;
    execute format('select count(*) from public.%I', v_kind) into previous;
    if actual < previous * 0.8 then
      raise exception 'Unexpected dataset shrink: %', v_kind using errcode = '22023';
    end if;
  end loop;
  if not exists (select 1 from public.market_import_rows r where run_id=p_run and r.kind='market_snapshots'
    and payload->>'key'='metadata' and payload->'data'->>'generatedAt'=source->>'collectedAt') then
    raise exception 'Snapshot collection version mismatch' using errcode='22023';
  end if;

  delete from public.complex_trades where complex is not null;
  insert into public.complex_trades (complex,gu,area_m2,sample_size,latest_year_month,max_floor,trades,updated_at)
  select x.complex,x.gu,x.area_m2,x.sample_size,x.latest_year_month,x.max_floor,x.trades,x.updated_at
  from public.market_import_rows r cross join lateral jsonb_populate_record(null::public.complex_trades,r.payload) x
  where run_id=p_run and kind='complex_trades';
  delete from public.complex_prices where complex is not null;
  insert into public.complex_prices (complex,sigungu,gu,area_bucket,median_price,sample_size,latest_year_month,built_year,area_m2,earliest_year_month)
  select x.complex,x.sigungu,x.gu,x.area_bucket,x.median_price,x.sample_size,x.latest_year_month,x.built_year,x.area_m2,x.earliest_year_month
  from public.market_import_rows r cross join lateral jsonb_populate_record(null::public.complex_prices,r.payload) x
  where run_id=p_run and kind='complex_prices';
  delete from public.price_trends where gu is not null;
  insert into public.price_trends (region,gu,area_bucket,year_month,price,sample_size,is_estimated)
  select x.region,x.gu,x.area_bucket,x.year_month,x.price,x.sample_size,x.is_estimated
  from public.market_import_rows r cross join lateral jsonb_populate_record(null::public.price_trends,r.payload) x
  where run_id=p_run and kind='price_trends';
  delete from public.market_snapshots where key is not null;
  insert into public.market_snapshots (key,data,updated_at)
  select payload->>'key',payload->'data',now() from public.market_import_rows where run_id=p_run and kind='market_snapshots';
  delete from public.market_import_rows where run_id=p_run;
  return p_manifest->'tables';
end;
$$;
revoke all on function public.publish_market_dataset(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_market_dataset(uuid,jsonb) to service_role;
grant select on public.complex_prices, public.complex_trades, public.price_trends, public.market_snapshots to anon,authenticated;
