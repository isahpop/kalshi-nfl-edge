import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRecentKalshiSettlements,normalizeSettlement,summarizeObservedSettlements} from './settlements.mjs';
import {createQuoteBatch,summarizeQuoteBatches} from './price-history.mjs';

const ticker='KXNFLGAME-26OCT08TBDAL-DAL';
const snap=createQuoteBatch([{ticker,status:'active',yes_ask_dollars:'0.80',no_ask_dollars:'0.21'}],{capturedAt:'2026-10-08T20:00:00Z'});
const quotes=summarizeQuoteBatches([snap],{asOf:'2026-10-09T21:00:00Z'});

test('settlements must be official, with explicit result or numeric payout',()=>{
  assert.equal(normalizeSettlement({ticker,status:'open',result:'yes'}),null);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:''}),null);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:'yes'}).yesPayout,1);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:'no'}).yesPayout,0);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:'void'}),null);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:'void',settlement_value_dollars:'0.5000'}).yesPayout,0.5);
  assert.equal(normalizeSettlement({ticker,status:'settled',result:'yes',settlement_value_dollars:'0.5000'}).yesPayout,.5);
  assert.equal(normalizeSettlement({ticker:'A-B',status:'settled',result:'yes'}),null);
});
test('reports outcomes for observed tickers only, not a fabricated paper ROI',()=>{
  const out=summarizeObservedSettlements(quotes,{markets:[
    {ticker,status:'settled',result:'yes',settlement_ts:'2026-10-09T03:00:00Z'},
    {ticker:'KXNFLGAME-26OCT08TBDAL-TB',status:'settled',result:'no'}],fetchedAt:'2026-10-09T21:00:00Z'});
  assert.equal(out.verifiedSettlements,1);
  assert.equal(out.unresolvedOrUnverified,0);
  assert.equal(out.records[0].firstObservedYesAsk,.8);
  assert.equal(out.records[0].yesPayout,1);
  assert.ok(!('roi' in out.records[0]));
  assert.ok(!('profit' in out.records[0]));
});
test('paginated settled-market fetch applies series and recent cutoff; rejects incomplete pages',async()=>{
  let urls=[];
  const fetchImpl=async url=>{urls.push(new URL(url));return{ok:true,json:async()=>({markets:[{ticker,status:'settled',result:'no'}],cursor:urls.length===1?'next':''})}};
  const out=await fetchRecentKalshiSettlements({at:'2026-10-09T21:00:00Z',fetchImpl});
  assert.equal(out.pages,2);assert.equal(out.markets.length,1);
  assert.equal(urls[0].searchParams.get('status'),'settled');
  assert.equal(urls[0].searchParams.get('series_ticker'),'KXNFLGAME');
  assert.equal(urls[1].searchParams.get('cursor'),'next');
  await assert.rejects(fetchRecentKalshiSettlements({at:'2026-10-09T21:00:00Z',maxPages:1,fetchImpl:async()=>({ok:true,json:async()=>({markets:[],cursor:'more'})})}),/pagination incomplete/);
});
test('API failures must not be interpreted as zero settled games',async()=>{
  await assert.rejects(fetchRecentKalshiSettlements({fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
  assert.throws(()=>summarizeObservedSettlements(quotes,{error:'down'}),/complete response/);
});

test('collector stores verified settlement alongside quotes and preserves it if Kalshi later fails',async()=>{
  const {mkdtemp,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {collectQuotes}=await import('../scripts/collect-quotes.mjs');
  const root=await mkdtemp(join(tmpdir(),'edge-settlements-'));
  const feed=async()=>({markets:[{ticker,status:'active',yes_ask_dollars:'0.80',no_ask_dollars:'0.21'}],truncated:false});
  const feeFeed=async()=>({feeMultiplier:1,feeVerified:true});
  try{
    const first=await collectQuotes({root,now:new Date('2026-10-09T21:00:00Z'),feed,feeFeed,
      settledFeed:async()=>({markets:[{ticker,status:'settled',result:'yes'}],fetchedAt:'2026-10-09T21:00:00Z'})});
    assert.equal(first.snapshots,1);
    const file=join(root,'public','data','kalshi-history.json');
    let stored=JSON.parse(await readFile(file,'utf8'));
    assert.equal(stored.settlements.verifiedSettlements,1);
    await collectQuotes({root,now:new Date('2026-10-09T23:00:00Z'),feed,feeFeed,
      settledFeed:async()=>{throw new Error('simulated 503');}});
    stored=JSON.parse(await readFile(file,'utf8'));
    assert.equal(stored.snapshots,2);
    assert.equal(stored.settlements.verifiedSettlements,1);
    assert.equal(stored.settlements.stale,true);
    assert.match(stored.settlements.error,/simulated 503/);
  } finally {await rm(root,{recursive:true,force:true});}
});
