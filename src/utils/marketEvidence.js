import { expandTradeRow, median, normalizeDealing, shiftMonth } from './priceBasis.js';

// Current source evidence never changes the saved approval or price verdict.
export function marketEvidence(rows, { complexName, area, asOf } = {}) {
  const start = asOf ? shiftMonth(asOf, -35) : null;
  const trades = rows.flatMap(expandTradeRow).filter(t => normalizeDealing(t.dealing)==='b'
    && (!start || t.yearMonth>=start) && (!asOf || t.yearMonth<=asOf));
  const mine = trades.filter(t => t.areaM2===Math.floor(Number(area)));
  const months = new Map(), areas = new Map();
  for (const t of trades) {
    if(!areas.has(t.areaM2)) areas.set(t.areaM2,[]);
    areas.get(t.areaM2).push(t);
  }
  for (const t of mine) {
    if(!months.has(t.yearMonth)) months.set(t.yearMonth,[]);
    months.get(t.yearMonth).push(t.price);
  }
  const recent = (a,b) => b.yearMonth.localeCompare(a.yearMonth) || Number(b.day)-Number(a.day);
  mine.sort(recent);
  const latest = mine[0];
  return {
    recentTransactionDate: latest ? `${latest.yearMonth}${latest.day ? `-${String(latest.day).padStart(2,'0')}` : ''}` : '',
    priceHistory: [...months].sort(([a],[b])=>a.localeCompare(b)).map(([yearMonth,values])=>({yearMonth,month:yearMonth.slice(2).replace('-','.'),price:median(values),count:values.length,estimated:false})),
    priceTable: { complexName, myAreaM2:Math.floor(Number(area)),
      areaSummary:[...areas].sort(([a],[b])=>a-b).map(([areaM2,items])=>{items.sort(recent);return {areaM2,isMine:areaM2===Math.floor(Number(area)),count:items.length,
        recentPrice:items[0].price,recentMonth:items[0].yearMonth,minPrice:Math.min(...items.map(t=>t.price)),maxPrice:Math.max(...items.map(t=>t.price))};}),
      recentTrades:mine.slice(0,20) },
  };
}
