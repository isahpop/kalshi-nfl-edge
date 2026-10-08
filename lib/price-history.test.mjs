import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQuoteBatch,summarizeQuoteBatches} from './price-history.mjs';
import {collectQuotes} from '../scripts/collect-quotes.mjs';
const ticker='KXNFLGAME-26OCT11DETARI-DET';
const quote=(price,status='active')=>({ticker,event_ticker:'KXNFLGAME-26OCT11DETARI',status,
  yes_ask_dollars:String(price),no_ask_dollars:String(1-price+.01),yes_bid_dollars:String(price-.01),
  no_bid_dollars:String(1-price),yes_ask_size_fp:'200',no_ask_size_fp:'400'});
test('snapshot preserves the public executable quotes without secrets or nonexistent fills',()=>{
  const batch=createQuoteBatch([quote(.71),quote(.73),quote(.31,'closed'),{ticker:'bad'}],{capturedAt:'2026-10-08T20:00:00Z',feeMultiplier:1,feeVerified:true});
  assert.equal(batch.markets.length,1);
  assert.equal(batch.markets[0].yesAsk,.71);
  assert.equal(batch.markets[0].yesSize,200);
  assert.equal(batch.feeMultiplier,1);
  assert.ok(!JSON.stringify(batch).includes('SPORTSGAMEODDS_API_KEY'));
});
test('summaries track timestamped ask movements not a fabricated realized return',()=>{
  const first=createQuoteBatch([quote(.7)],{capturedAt:'2026-10-08T20:00:00Z'});
  const later=createQuoteBatch([quote(.75)],{capturedAt:'2026-10-08T22:00:00Z'});
  const report=summarizeQuoteBatches([later,first],{asOf:'2026-10-08T23:00:00Z'});
  assert.equal(report.snapshots,2);assert.equal(report.observations,2);
  assert.equal(report.contracts[ticker].yesAskChangeCents,5);
  assert.equal(report.contracts[ticker].latestYesAsk,.75);
  assert.ok(!('roi' in report.contracts[ticker]));
});
test('collector writes a daily JSONL archive and deployable summary without any credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edge-lab-'));
  try{
    const result=await collectQuotes({root,now:new Date('2026-10-08T20:00:00Z'),feed:async()=>({markets:[quote(.7)],truncated:false}),feeFeed:async()=>({feeMultiplier:1,feeVerified:true}),settledFeed:async()=>({markets:[],fetchedAt:'2026-10-08T20:00:00Z'})});
    assert.equal(result.marketCount,1);
    assert.match(await readFile(join(root,'data','snapshots','2026-10-08.jsonl'),'utf8'),/yesAsk/);
    const summary=JSON.parse(await readFile(join(root,'public','data','kalshi-history.json'),'utf8'));
    assert.equal(summary.trackedContracts,1);
    await assert.rejects(collectQuotes({root,now:new Date('2026-10-08T22:00:00Z'),feed:async()=>({markets:[],truncated:false}),feeFeed:async()=>({feeMultiplier:1,feeVerified:true}),settledFeed:async()=>({markets:[],fetchedAt:'2026-10-08T20:00:00Z'})}),/nothing saved/);
  }finally{await rm(root,{recursive:true,force:true});}
});
