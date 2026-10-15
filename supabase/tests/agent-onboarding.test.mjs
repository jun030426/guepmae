import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const pg = new PGlite();
const ids = Object.fromEntries(['user','other','admin','owner'].map((role,i)=>[role,`00000000-0000-4000-8000-00000000000${i+1}`]));
const app = '10000000-0000-4000-8000-000000000001';
const details = { office_name:'검증 사무소',office_registration_number:'TEST',representative_name:'검증',representative_phone:'000',contact_email:'spoof@example.invalid',status:'approved' };
const docs = ['business-registration','broker-license'].map(label=>({ label,path:`${ids.user}/${app}/${label}.pdf` }));
before(async()=>{
  await pg.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create type public.app_role as enum('user','agent','admin','owner');
    create table public.profiles(id uuid primary key,email text,role app_role,suspended boolean default false,updated_at timestamptz);
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.current_user_role() returns app_role language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and not suspended$$;
    create table public.agent_applications(id uuid primary key,office_name text,office_registration_number text,office_address text,representative_name text,representative_phone text,contact_email text,contact_phone text,document_paths jsonb,status text default 'pending',reviewer_note text,created_at timestamptz default now());
    alter table public.agent_applications enable row level security;
    grant all on public.agent_applications to anon,authenticated;
    create policy "Admins can read agent applications" on public.agent_applications for select to authenticated using(public.current_user_role()::text in ('admin','owner'));
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant all on storage.objects to anon,authenticated;`);
  await pg.exec(await fs.readFile(new URL('../migrations/20261015072558_secure_agent_onboarding.sql',import.meta.url),'utf8'));
});
beforeEach(async()=>{
  await pg.exec('delete from public.agent_applications; delete from storage.objects; delete from public.profiles; delete from auth.users;');
  for(const [role,id] of Object.entries(ids)) {
    await pg.query('insert into public.profiles(id,email,role) values($1,$2,$3)',[id,`${role}@example.invalid`,role==='other'?'user':role]);
    await pg.query('insert into auth.users values($1,$2,now())',[id,`${role}@example.invalid`]);
  }
  for(const doc of docs) await pg.query("insert into storage.objects(bucket_id,name) values('agent-application-documents',$1)",[doc.path]);
});
after(()=>pg.close());
const as = (actor,sql,values=[]) => pg.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[ids[actor]||'']);
  await tx.exec(`set local role ${actor==='anon'?'anon':'authenticated'}`);
  return tx.query(sql,values);
});
const submit = (actor='user',documents=docs) => as(actor,'select public.submit_agent_application($1,$2,$3) result',[app,details,documents]);
const review = (actor='owner',status='approved') => as(actor,'select public.review_agent_application($1,$2,null) result',[app,status]);
const role = async()=> (await pg.query('select role from profiles where id=$1',[ids.user])).rows[0].role;

test('anonymous submission and direct writes cannot bypass verified submission',async()=>{
  await assert.rejects(submit('anon'),/permission denied/);
  await assert.rejects(as('user',"insert into agent_applications(id,status) values($1,'approved')",[app]),/permission denied/);
  await pg.query('update auth.users set email_confirmed_at=null where id=$1',[ids.user]);
  await assert.rejects(submit(),/이메일 인증/);
});
test('submission uses verified identity, forces pending and deduplicates retries',async()=>{
  const first=(await submit()).rows[0].result;
  assert.equal(first.status,'pending');
  const row=(await pg.query('select * from agent_applications')).rows[0];
  assert.equal(row.contact_email,'user@example.invalid');assert.equal(row.user_id,ids.user);
  assert.equal((await submit()).rows[0].result.alreadySubmitted,true);
  assert.equal((await pg.query('select count(*)::int n from agent_applications')).rows[0].n,1);
});
test('missing, repeated and another applicant documents are rejected',async()=>{
  await assert.rejects(submit('user',[]),/두 종류/);
  await assert.rejects(submit('user',[docs[0],docs[0]]),/두 종류/);
  await assert.rejects(submit('other'),/본인 계정/);
  await pg.query('delete from storage.objects where name=$1',[docs[1].path]);
  await assert.rejects(submit(),/본인 계정/);
});
test('owner and admin can read documents and approve with role in one transaction',async()=>{
  await submit();
  for(const actor of ['owner','admin']) assert.equal((await as(actor,'select * from storage.objects')).rows.length,2);
  await review('owner');assert.equal(await role(),'agent');
  const row=(await pg.query('select status,reviewed_by,reviewed_at from agent_applications')).rows[0];
  assert.equal(row.status,'approved');assert.equal(row.reviewed_by,ids.owner);assert.ok(row.reviewed_at);
});
test('admin approval works and stale conflicting reviews cannot overwrite it',async()=>{
  await submit();await review('admin');assert.equal(await role(),'agent');
  await assert.rejects(review('owner','rejected'),/이미 처리/);
});
test('failure saving application rolls back its role grant',async()=>{
  await submit();
  await pg.exec("create function public.fail_review() returns trigger language plpgsql as $$begin raise exception 'forced failure'; end;$$; create trigger fail_review before update on agent_applications for each row execute function public.fail_review();");
  try { await assert.rejects(review(),/forced failure/);assert.equal(await role(),'user'); }
  finally { await pg.exec('drop trigger fail_review on agent_applications; drop function public.fail_review();'); }
  assert.equal((await pg.query('select status from agent_applications')).rows[0].status,'pending');
});
test('ordinary and suspended accounts cannot review or gain access',async()=>{
  await submit();await assert.rejects(review('other'),/운영진/);
  await pg.query('update profiles set suspended=true where id=$1',[ids.owner]);
  await assert.rejects(review(),/운영진/);
  await pg.query('update profiles set suspended=true where id=$1',[ids.user]);
  await assert.rejects(review('admin'),/계정 상태/);
  assert.equal(await role(),'user');
});
test('rejection allows a corrected application while preserving the first review',async()=>{
  await submit();await review('owner','rejected');assert.equal(await role(),'user');
  const next='10000000-0000-4000-8000-000000000002';
  const nextDocs=docs.map(d=>({...d,path:d.path.replace(app,next)}));
  for(const doc of nextDocs) await pg.query("insert into storage.objects(bucket_id,name) values('agent-application-documents',$1)",[doc.path]);
  await as('user','select public.submit_agent_application($1,$2,$3)',[next,details,nextDocs]);
  assert.equal((await pg.query('select count(*)::int n from agent_applications')).rows[0].n,2);
});
test('private documents are isolated and submitted files cannot be deleted by applicant',async()=>{
  assert.equal((await as('other','select * from storage.objects')).rows.length,0);
  assert.equal((await as('anon','select * from storage.objects')).rows.length,0);
  await assert.rejects(as('other',"insert into storage.objects(bucket_id,name) values('agent-application-documents',$1)",[`${ids.user}/attack.pdf`]),/row-level security/);
  await assert.rejects(as('anon',"insert into storage.objects(bucket_id,name) values('agent-application-documents','pending/attack.pdf')"),/row-level security/);
  await submit();
  assert.equal((await as('other','select * from agent_applications')).rows.length,0);
  await as('user','delete from storage.objects where name=$1',[docs[0].path]);
  assert.equal((await pg.query('select count(*)::int n from storage.objects')).rows[0].n,2);
  await as('user',"insert into storage.objects(bucket_id,name) values('agent-application-documents',$1)",[`${ids.user}/unused.pdf`]);
  await as('user','delete from storage.objects where name=$1',[`${ids.user}/unused.pdf`]);
  assert.equal((await pg.query('select count(*)::int n from storage.objects')).rows[0].n,2);
});
