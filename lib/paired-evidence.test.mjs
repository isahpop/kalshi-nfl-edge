import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQuoteBatch} from './price-history.mjs';
import {collectQuotes} from '../scripts/collect-quotes.mjs';
import {shouldCaptureBookReference,fetchPublicBookReference,makePairedBookBatch,pairedFailure,summarizePairedBookBatches} from './paired-evidence.mjs';

const at='2026-10-11T16:17:00.000Z';
const ticker='KXNFLGAME-26OCT11DETARI-ARI';
const eventTicker='KXNFLGAME-26OCT11DETARI';
const market={ticker,event_ticker:eventTicker,status:'active',title:'Arizona wins',yes_sub_title:'Arizona',
  occurrence_datetime:'2026-10-11T20:00:00Z',yes_ask_dollars:'0.35',no_ask_dollars:'0.66',
  yes_bid_dollars:'0.34',no_bid_dollars:'0.65',yes_ask_size_fp:'100',no_ask_size_fp:'100'};
const reference=(time='2026-10-11T16:01:00.000Z')=>({configured:true,events:[{
  id:'game-01',home_team:'Arizona Cardinals',away_team:'Detroit Lions',commence_time:'2026-10-11T17:00:00Z',
  bookmakers:['dk','mgm','fd'].map(key=>({key,markets:[{key:'h2h',last_update:time,outcomes:[
    {name:'Arizona Cardinals',price:-150},{name:'Detroit Lions',price:130}
  ]}]}))
}],fetchedAt:time});
const batch=()=>createQuoteBatch([market],{capturedAt:at,feeMultiplier:1,feeVerified:true});

test('four scheduled weekly windows use UTC; skips all other routine Kalshi captures',()=>{
  assert.equal(shouldCaptureBookReference(at),true); // Sunday 16:17Z
  assert.equal(shouldCaptureBookReference('2026-10-11T20:20:00Z'),true);
  assert.equal(shouldCaptureBookReference('2026-10-12T22:17:00Z'),true); // Monday
  assert.equal(shouldCaptureBookReference('2026-10-08T22:17:00Z'),true); // Thursday
  assert.equal(shouldCaptureBookReference('2026-10-08T20:17:00Z'),false);
  assert.equal(shouldCaptureBookReference('2026-10-10T16:17:00Z'),false);
  assert.equal(shouldCaptureBookReference('not-a-date'),false);
});
test('Vercel public sportsbook endpoint never forwards a key and fails closed',async()=>{
  let called=[];
  const result=await fetchPublicBookReference({fetchImpl:async(url,opts)=>{called.push({url,opts});return{ok:true,json:async()=>reference()};}});
  assert.equal(result.events.length,1);
  assert.equal(called[0].url,'https://kalshi-nfl-edge.vercel.app/api/odds');
  assert.equal(called[0].opts.headers.accept,'application/json');
  assert.ok(!JSON.stringify(called).toLowerCase().includes('api-key'));
  await assert.rejects(fetchPublicBookReference({url:'https://evil.example/api/odds'}),/Invalid/);
  await assert.rejects(fetchPublicBookReference({fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/);
  await assert.rejects(fetchPublicBookReference({fetchImpl:async()=>({ok:true,json:async()=>({configured:false,events:[]})})}),/unconfigured/);
});
test('pairs only contemporaneous >=3 bookmaker no-vig probabilities and calculates cost before outcome',()=>{
  const r=makePairedBookBatch(batch(),[market],reference());
  assert.equal(r.matched,1);
  assert.equal(r.pairs[0].books,3);
  assert.equal(r.pairs[0].bookAgeMinutes,16);
  assert.equal(r.pairs[0].screenSide,'YES');
  assert.ok(r.pairs[0].yesProbability>.5);
  assert.ok(r.pairs[0].screenNetEdge>.02);
  assert.ok(r.pairs[0].screenCost>.35);
  assert.ok(!('actualProfit' in r.pairs[0]));
  assert.ok(!JSON.stringify(r).includes('SPORTSGAMEODDS_API_KEY'));
});
test('stale odds, ambiguous pair and unknown fees cannot generate candidates',()=>{
  assert.equal(makePairedBookBatch(batch(),[market],reference('2026-10-11T14:00:00Z')).matched,0);
  assert.throws(()=>makePairedBookBatch(batch(),[market],{events:[]}),/No sportsbook games/);
  const noFees=createQuoteBatch([market],{capturedAt:at,feeMultiplier:1,feeVerified:false});
  assert.equal(makePairedBookBatch(noFees,[market],reference()).pairs[0].screenSide,null);
  const noDepth=createQuoteBatch([{...market,yes_ask_size_fp:'',no_ask_size_fp:''}],{capturedAt:at,feeMultiplier:1,feeVerified:true});
  assert.equal(makePairedBookBatch(noDepth,[market],reference()).pairs[0].screenSide,null);
});
test('only FIRST eligible screen per game can contribute to transparent hypothetical settlement',()=>{
  const r=makePairedBookBatch(batch(),[market],reference());
  const later={...r,capturedAt:'2026-10-11T20:17:00Z',pairs:r.pairs.map(p=>({...p,screenNetEdge:.5}))};
  const outcome={ticker,yesPayout:1,settledAt:'2026-10-12T01:00:00Z'};
  const report=summarizePairedBookBatches([r,later],{asOf:'2026-10-13T00:00:00Z',settlements:[outcome]});
  assert.equal(report.attempts,2);
  assert.equal(report.firstCandidateGames,1);
  assert.equal(report.paperOneContract.settled,1);
  assert.ok(Math.abs(report.paperOneContract.hypotheticalNetDollars-(1-r.pairs[0].screenCost))<.02);
  const noFuture=summarizePairedBookBatches([r],{asOf:'2026-10-11T17:00:00Z',settlements:[{...outcome,settledAt:'2026-10-11T15:00:00Z'}]});
  assert.equal(noFuture.paperOneContract.settled,0);
  assert.equal(noFuture.paperOneContract.pending,1);
  assert.equal(summarizePairedBookBatches([pairedFailure(at,new Error('HTTP 403'))],{asOf:'2026-10-12T00:00:00Z'}).lastError,'HTTP 403');
});
test('full collector saves Kalshi quotes if sportsbook is unreachable; reruns within same hour never double-call books',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edge-v28-'));
  const feed=async()=>({markets:[market],truncated:false});
  const feeFeed=async()=>({feeMultiplier:1,feeVerified:true});
  const settledFeed=async()=>({markets:[],fetchedAt:at});
  let calls=0;
  try{
    const first=await collectQuotes({root,now:new Date(at),feed,feeFeed,settledFeed,bookFeed:async()=>{calls++;throw new Error('HTTP 502');}});
    assert.equal(first.snapshots,1);assert.equal(first.pairedAttempt,'unavailable');
    assert.equal(calls,1);
    const report=JSON.parse(await readFile(join(root,'public/data/kalshi-history.json'),'utf8')).pairedEvidence;
    assert.equal(report.failedCaptures,1);assert.equal(report.matchedObservations,0);
    const second=await collectQuotes({root,now:new Date('2026-10-11T16:32:00Z'),feed,feeFeed,settledFeed,bookFeed:async()=>{calls++;return reference();}});
    assert.equal(second.snapshots,2);assert.equal(second.pairedAttempt,'not scheduled');assert.equal(calls,1);
    const next=await collectQuotes({root,now:new Date('2026-10-11T20:17:00Z'),feed,feeFeed,settledFeed,bookFeed:async()=>{calls++;return reference('2026-10-11T20:02:00Z');}});
    assert.equal(next.pairedAttempt,'success');assert.equal(calls,2);
    const all=JSON.parse(await readFile(join(root,'public/data/kalshi-history.json'),'utf8')).pairedEvidence;
    assert.equal(all.successfulCaptures,1);
    assert.equal(all.attempts,2);
    const raw=(await readFile(join(root,'data/snapshots/2026-10-11.jsonl'),'utf8')).trim().split('\n');
    assert.equal(raw.length,3);
    assert.equal(JSON.parse(raw[0]).bookPair.status,'unavailable');
    assert.equal(JSON.parse(raw[1]).bookPair,undefined);
    assert.equal(JSON.parse(raw[2]).bookPair.status,'success');
  }finally{await rm(root,{recursive:true,force:true});}
});
