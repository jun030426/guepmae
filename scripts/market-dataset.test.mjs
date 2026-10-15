import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset, validateReceipt } from './build-market-dataset.mjs';
import { marketEvidence } from '../src/utils/marketEvidence.js';
import { computePriceBasis, expandTradeRow } from '../src/utils/priceBasis.js';

const raw = (patch={}) => ({'시군구':'서울특별시 강남구 역삼동','시군구기준':'서울특별시 강남구','단지명':'동명',
  '거래금액(만원)':'10000','전용면적(㎡)':'84.9','계약년월':'202609','층':'12','일':'5','거래유형':'중개거래','아파트일련번호':'11680-1','지번':'1',...patch});
const receipt = (rows) => ({start:'2023-10',end:'2026-09',months:36,rows,districts:{'11680':'서울특별시 강남구'},collectedAt:'2026-10-15T00:00:00Z'});

test('market dataset separates same-name apartments, excludes direct/cancelled trades and uses real medians',()=>{
  const rows = [raw(),raw(),raw({'거래금액(만원)':'8000'}),raw({'아파트일련번호':'11680-2','거래금액(만원)':'50000'}),
    raw({'거래유형':'직거래','거래금액(만원)':'1'}),raw({'해제여부':'O'}),raw({'계약년월':'202510'})];
  const data=buildDataset(rows,receipt(rows.length));
  assert.equal(data.complex_trades.length,2);
  assert.equal(new Set(data.complex_trades.map(r=>r.complex)).size,2);
  assert.equal(data.complex_prices.find(r=>r.complex.includes('11680-1')).median_price,100e6);
  assert.equal(data.complex_trades.reduce((s,r)=>s+r.sample_size,0),5);
  assert.equal(data.price_trends.find(r=>r.year_month==='2026-09').sample_size,4);
  assert.ok(data.price_trends.every(r=>!r.is_estimated));
  const evidence=marketEvidence(data.complex_trades.filter(r=>r.complex.includes('11680-1')),{area:84.9,asOf:'2026-09'});
  assert.equal(evidence.priceHistory.length,2);
  assert.equal(evidence.priceTable.recentTrades.length,4);
});

test('market data uses full city districts, never drops an ordinary dong suffix, and rejects unknown provenance',()=>{
  const row=raw({'시군구기준':'경기도 안동시','시군구':'경기도 안동시 옥동'});
  assert.equal(buildDataset([row],receipt(1)).complex_prices[0].gu,'경기도 안동시');
  assert.throws(()=>buildDataset([raw({'거래유형':''})],receipt(1)),/Invalid/);
  assert.throws(()=>buildDataset([raw()],receipt(2)),/Invalid/);
});

test('receipt rejects a modified input or missing district-month',()=>{
  const r={...receipt(1),sha256:'hash',expectedPairs:36,completedPairs:36,failures:[],missingRegionMonths:[]};
  validateReceipt(r,'hash');
  assert.throws(()=>validateReceipt(r,'other'));
  assert.throws(()=>validateReceipt({...r,completedPairs:35},'hash'));
});

test('live evidence omits direct trades and old months without fabricating missing-month prices',()=>{
  const rows=[{area_m2:84,trades:[['2023-09','1',1e6,12,'b'],['2025-10','1',100e6,12,'b'],['2026-09','2',120e6,12,'b'],['2026-09','3',1e6,1,'d']]}];
  const e=marketEvidence(rows,{area:84.9,asOf:'2026-09'});
  assert.equal(e.priceHistory.length,2);
  assert.equal(e.recentTransactionDate,'2026-09-02');
  assert.equal(e.priceTable.recentTrades[0].price,120e6);
  assert.equal(e.priceTable.areaSummary[0].count,2);
});

test('imported individual trades drive the real floor-adjusted price resolver',()=>{
  const rows=[...Array.from({length:3},()=>raw({'거래금액(만원)':'20000','층':'2'})),...Array.from({length:3},()=>raw({'거래금액(만원)':'50000','층':'12'}))];
  const data=buildDataset(rows,receipt(rows.length));
  const basis=computePriceBasis({trades:data.complex_trades.flatMap(expandTradeRow),areaM2:84,floor:'2층',price:180e6,asOf:'2026-09'});
  assert.equal(basis.baselinePrice,200e6);
});
