import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const pg=new PGlite();
const run='00000000-0000-4000-8000-000000000001';
const manifest={source:{months:36,completedPairs:36,expectedPairs:36,districts:{11:'서울'},rows:3,failures:[],missingRegionMonths:[],collectedAt:'2026-10-15T00:00:00Z'},tables:{}};
const payloads={complex_trades:{complex:'새 단지',gu:'서울',area_m2:84,sample_size:3,trades:[['2026-09','1',100,12,'b']],updated_at:'2026-10-15T00:00:00Z'},
  complex_prices:{complex:'새 단지',gu:'서울',sigungu:'서울 강남구 역삼동',area_m2:84,area_bucket:'60–85㎡',median_price:100,sample_size:3},
  price_trends:{region:'서울',gu:'서울',area_bucket:'60–85㎡',year_month:'2026-09',price:100,sample_size:3,is_estimated:false},
  market_snapshots:{key:'metadata',data:{generatedAt:'2026-10-15T00:00:00Z'}}};
before(async()=>{
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table complex_prices(id bigint generated always as identity,complex text not null,gu text,sigungu text,area_m2 int,area_bucket text,median_price bigint,sample_size int,built_year int,earliest_year_month text,latest_year_month text,unique(complex,gu,area_m2));
    create table complex_trades(complex text not null,gu text,area_m2 int,sample_size int,trades jsonb,max_floor int,latest_year_month text,updated_at timestamptz,primary key(complex,gu,area_m2));
    create table price_trends(id bigint generated always as identity,region text,gu text,area_bucket text,year_month text,price bigint,sample_size int,is_estimated boolean);
    create table market_snapshots(key text primary key,data jsonb,updated_at timestamptz);
    grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to service_role;
    insert into complex_prices(complex,gu,area_m2) values('이전 단지','서울',84);`);
  await pg.exec(await fs.readFile(new URL('../migrations/20261015053720_publish_market_dataset.sql',import.meta.url),'utf8'));
  await pg.exec(await fs.readFile(new URL('../migrations/20261015061129_market_publish_safe_updates.sql',import.meta.url),'utf8'));
  await pg.exec(await fs.readFile(new URL('../migrations/20261015061503_market_publish_timeout.sql',import.meta.url),'utf8'));
  for(const name of Object.keys(payloads)) manifest.tables[name]={rows:1};
});
after(()=>pg.close());
async function call(m=manifest,role='service_role') {
  return pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query('select publish_market_dataset($1,$2)',[run,JSON.stringify(m)]);});
}
async function stage() {
  await pg.exec('delete from market_import_rows');
  for(const [kind,payload] of Object.entries(payloads)) await pg.query('insert into market_import_rows values($1,$2,0,$3)',[run,kind,JSON.stringify(payload)]);
}
test('public clients cannot read staging or publish data',async()=>{
  for(const role of ['anon','authenticated']) {
    await assert.rejects(call(manifest,role),/permission denied/);
    await assert.rejects(pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query('select * from market_import_rows');}),/permission denied/);
  }
});
test('partial import and incomplete collection leave the previous data intact',async()=>{
  await stage();
  await pg.query("delete from market_import_rows where kind='price_trends'");
  await assert.rejects(call(),/Incomplete staging/);
  await assert.rejects(call({...manifest,source:{...manifest.source,completedPairs:35}}),/Incomplete collection/);
  assert.equal((await pg.query('select complex from complex_prices')).rows[0].complex,'이전 단지');
});
test('failure after deletes rolls back the complete transaction',async()=>{
  await stage();
  await pg.query("update market_import_rows set payload=payload-'complex' where kind='complex_prices'");
  await assert.rejects(call(),/not-null constraint/);
  assert.equal((await pg.query('select complex from complex_prices')).rows[0].complex,'이전 단지');
  assert.equal((await pg.query('select count(*)::int n from complex_trades')).rows[0].n,0);
});
test('complete publication replaces data and removes staging',async()=>{
  await stage();await call();
  assert.equal((await pg.query('select complex from complex_prices')).rows[0].complex,'새 단지');
  assert.equal((await pg.query('select count(*)::int n from market_import_rows')).rows[0].n,0);
});
test('an older collected dataset cannot overwrite a newer publication',async()=>{
  await stage();
  await assert.rejects(call({...manifest,source:{...manifest.source,collectedAt:'2026-10-14T00:00:00Z'}}),/newer dataset/);
});
