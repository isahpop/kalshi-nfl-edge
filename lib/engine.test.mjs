import test from 'node:test';
import assert from 'node:assert/strict';
import { takerFee, evaluateOrder, sizePosition, paperSummary, settlePaperTrade, validPrice, noVigTwoWay } from './finance.mjs';
import { consensusForMarket } from './consensus.mjs';
import { matchEventForMarket } from './teams.mjs';
import { scoreMarket } from './engine.mjs';
const now=Date.parse('2026-10-08T19:00:00Z');
const kickoff='2026-10-11T17:00:00Z';
const market={ ticker:'KXNFLGAME-26OCT11DALPHI-DAL',event_ticker:'KXNFLGAME-26OCT11DALPHI',status:'open',title:'Dallas Cowboys at Philadelphia Eagles',yes_sub_title:'Dallas Cowboys',updated_time:'2026-10-08T18:55:00Z',expected_expiration_time:kickoff,yes_ask_dollars:'0.3500',yes_bid_dollars:'0.3300',no_ask_dollars:'0.6700',no_bid_dollars:'0.6500',yes_ask_size_fp:'15.00',no_ask_size_fp:'12.00'};
const makeBook=(key,home=-125,away=110,updated='2026-10-08T18:55:00Z')=>({key,last_update:updated,markets:[{key:'h2h',last_update:updated,outcomes:[{name:'Philadelphia Eagles',price:home},{name:'Dallas Cowboys',price:away}]}]});
const event={id:'test',home_team:'Philadelphia Eagles',away_team:'Dallas Cowboys',commence_time:kickoff,bookmakers:[makeBook('a'),makeBook('b',-130,112),makeBook('c',-120,105)]};
test('current three-book consensus is independent, no-vig, and bounded',()=>{
  const a=consensusForMarket(market,[event],{now});
  assert.equal(a.books,3); assert.ok(a.probability>.43 && a.probability<.49);
  assert.ok(a.range<.08); assert.equal(a.source,'Median no-vig sportsbook moneyline');
});
test('no consensus from 1 book or 2 books',()=>{
  assert.equal(consensusForMarket(market,[{...event,bookmakers:event.bookmakers.slice(0,1)}],{now}),null);
  assert.equal(consensusForMarket(market,[{...event,bookmakers:event.bookmakers.slice(0,2)}],{now}),null);
});
test('reject expired odds and bookmaker disagreement',()=>{
  assert.equal(consensusForMarket(market,[{...event,bookmakers:event.bookmakers.map(x=>({...x,last_update:'2026-10-07T08:00:00Z',markets:x.markets.map(m=>({...m,last_update:'2026-10-07T08:00:00Z'}))}))}],{now}),null);
  const disagree={...event,bookmakers:[makeBook('a',-250,220),makeBook('b',-110,-110),makeBook('c',250,-350)]};
  assert.equal(consensusForMarket(market,[disagree],{now}),null);
});
test('reject wrong or ambiguous events, and games that have started',()=>{
  assert.equal(matchEventForMarket(market,[event,{...event,id:'dup'}],now),null);
  assert.equal(matchEventForMarket({...market,title:'Chicago Bears at Denver Broncos',event_ticker:'KXNFLGAME-26OCT11CHIDEN'},[event],now),null);
  assert.ok(matchEventForMarket({...market,title:'Winner of the game'},[event],now));
  assert.equal(matchEventForMarket(market,[{...event,commence_time:'2026-10-08T18:00:00Z'}],now),null);
});
test('fee is rounded once per simulated order not per contract',()=>{
  assert.equal(takerFee(1,.5),.02);assert.equal(takerFee(100,.5),1.75);
  assert.equal(takerFee(1,.5,.5),.01);assert.equal(takerFee(0,.5),0);
  assert.equal(takerFee(-1,.5),null);
});
test('1 cent slippage and fee decrease expected value',()=>{
  const calc=evaluateOrder(.65,.5,5,{feeMultiplier:1,slippageCents:1});
  assert.ok(calc);assert.ok(calc.cost>2.55);assert.ok(calc.netEdge<.15);
  assert.ok(calc.breakeven>.51); assert.ok(calc.netRoi>0);
  assert.equal(evaluateOrder(.65,.99,1,{slippageCents:1}),null);
  assert.equal(validPrice(null),null);
  assert.equal(noVigTwoWay(null,-120),null);
});
test('max stake cannot exceed 5 percent paper equity, and respects fees',()=>{
  const s=sizePosition(.84,.4,200,{askSize:500,slippageCents:1});
  assert.ok(s.contracts>0);assert.ok(s.stake<=10);assert.ok(s.fees>0);
  assert.equal(sizePosition(.5,.49,200,{slippageCents:1}).contracts,0);
});
test('order cannot exceed quote depth or game exposure',()=>{
  const depth=sizePosition(.95,.3,200,{askSize:2});assert.ok(depth.contracts<=2);
  assert.equal(sizePosition(.9,.5,200,{remainingBudget:0}).contracts,0);
});
test('qualified signal requires data quality, net edge, and verified fees',()=>{
  const scored=scoreMarket(market,[event],{now,snapshotAt:new Date(now).toISOString(),feeMultiplier:1,feeVerified:true});
  assert.ok(scored.auto);assert.equal(scored.best.side,'YES');assert.equal(scored.qualified,true);
  const noFee=scoreMarket(market,[event],{now,snapshotAt:new Date(now).toISOString(),feeMultiplier:1,feeVerified:false});
  assert.equal(noFee.qualified,false);
  const missingSize=scoreMarket({...market,yes_ask_size_fp:null},[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.equal(missingSize.qualified,false);
  const stale=scoreMarket(market,[event],{now,snapshotAt:'2026-10-06T18:00:00Z',feeVerified:true});
  assert.equal(stale.qualified,false);
  const eightHoursAgo='2026-10-08T11:00:00Z';
  const older={...event,bookmakers:event.bookmakers.map(b=>({...b, last_update:eightHoursAgo,markets:b.markets.map(m=>({...m,last_update:eightHoursAgo}))}))};
  const old=scoreMarket(market,[older],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.ok(old.auto,'Older cached model is still presented as research');
  assert.equal(old.qualified,false, 'Stale sportsbook data may never qualify for a signal');
  assert.ok(old.best.reasons.includes('Sportsbook odds older than 60 minutes: reference only'));
});
test('manual probabilities are scenario analyses not automatic signals',()=>{
  const scored=scoreMarket(market,[],{now,manualFair:70,feeVerified:true});
  assert.equal(scored.fair,.70);assert.equal(scored.isManual,true);assert.equal(scored.qualified,false);
  assert.equal(scoreMarket(market,[],{now,manualFair:'invalid',feeVerified:true}).fair,null);
});
test('paper positions use realized P&L and release reserved capital at settlement',()=>{
  const t={id:'x',ticker:'example',contracts:5,stake:2.65,status:'open',pnl:0};
  const before=paperSummary([t],200);
  assert.equal(before.available,197.35); assert.equal(before.atRisk,2.65);
  const won=settlePaperTrade(t,'won');
  assert.equal(won.pnl,2.35);assert.equal(paperSummary([won],200).equity,202.35);
  assert.equal(paperSummary([settlePaperTrade(t,'lost')],200).realized,-2.65);
  assert.equal(paperSummary([settlePaperTrade(t,'void')],200).realized,0);
  assert.equal(settlePaperTrade(won,'won'),null);
});

test('short Kalshi team labels resolve exactly',async()=>{const { matchTeam } = await import('./teams.mjs');assert.equal(matchTeam('KC Chiefs',['Kansas City Chiefs','Las Vegas Raiders']),'Kansas City Chiefs');assert.equal(matchTeam('TB Buccaneers',['Tampa Bay Buccaneers','Dallas Cowboys']),'Tampa Bay Buccaneers');});
