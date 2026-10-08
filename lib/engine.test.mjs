import test from 'node:test';
import assert from 'node:assert/strict';
import { takerFee, evaluateOrder, sizePosition, paperSummary, settlePaperTrade, validPrice, noVigTwoWay } from './finance.mjs';
import { consensusForMarket } from './consensus.mjs';
import { isKalshiOpen, matchEventForMarket, matchTeam } from './teams.mjs';
import { scoreMarket, summarizeScan } from './engine.mjs';
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

test('Kalshi status active is tradable; settled markets cannot be modeled',()=>{
  assert.equal(isKalshiOpen({status:'active'}),true);
  assert.equal(isKalshiOpen({status:'open'}),true);
  assert.equal(isKalshiOpen({status:'settled'}),false);
  const active=scoreMarket({...market,status:'active'},[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.ok(active.auto);
  assert.equal(active.qualified,true);
  assert.equal(matchEventForMarket({...market,status:'settled'},[event],now),null);
});

test('actual Kalshi event format and SportsGameOdds kickoff gap produce REFERENCE, not a trade signal',()=>{
  const time=Date.parse('2026-10-08T19:22:12Z');
  const kalshi={...market, status:'active',ticker:'KXNFLGAME-26OCT08TBDAL-DAL',event_ticker:'KXNFLGAME-26OCT08TBDAL',
    title:'Dallas wins',yes_sub_title:'Dallas',occurrence_datetime:'2026-10-09T03:15:00Z',
    yes_ask_dollars:'0.8000',yes_bid_dollars:'0.7900',no_ask_dollars:'0.2100',no_bid_dollars:'0.2000'};
  const actualBook=(key,home,away)=>({key,last_update:'2026-10-08T19:15:41Z',markets:[{key:'h2h',last_update:'2026-10-08T19:15:41Z',outcomes:[
    {name:'Dallas Cowboys',price:home},{name:'Tampa Bay Buccaneers',price:away}
  ]}]});
  const match={id:'actual',home_team:'Dallas Cowboys',away_team:'Tampa Bay Buccaneers',commence_time:'2026-10-09T00:15:00Z',bookmakers:[
    actualBook('draftkings',-500,380),actualBook('fanduel',-500,385),actualBook('caesars',-480,370)
  ]};
  const scored=scoreMarket(kalshi,[match],{now:time,snapshotAt:'2026-10-08T19:22:12Z',feeVerified:true});
  assert.ok(scored.auto,'independent moneyline probability should be modeled');
  assert.equal(scored.auto.books,3);
  assert.equal(scored.auto.kickoffGapMinutes,180);
  assert.ok(scored.best,'market should have a model comparison');
  assert.equal(scored.qualified,false,'time disagreement must never become an actionable signal');
  assert.match(scored.best.reasons.join(' '),/kickoff times disagree by 180 minutes/);
});

test('short city labels and JAC ticker code still resolve to exact teams',()=>{
  assert.equal(matchTeam('Los Angeles C',['Los Angeles Chargers','Denver Broncos']),'Los Angeles Chargers');
  assert.equal(matchTeam('Los Angeles R',['Los Angeles Rams','Buffalo Bills']),'Los Angeles Rams');
  assert.equal(matchTeam('New York J',['New York Jets','Cleveland Browns']),'New York Jets');
  assert.equal(matchTeam('New York G',['New York Giants','Washington Commanders']),'New York Giants');
  const matching={id:'jags',home_team:'Jacksonville Jaguars',away_team:'Philadelphia Eagles',commence_time:kickoff};
  const short={...market,ticker:'KXNFLGAME-26OCT11PHIJAC-JAC',event_ticker:'KXNFLGAME-26OCT11PHIJAC',
    title:'Jacksonville wins',yes_sub_title:'Jacksonville',status:'active'};
  assert.equal(matchEventForMarket(short,[matching],now)?.selection,'Jacksonville Jaguars');
});

test('negative expected value is not misreported as inability to afford a contract',()=>{
  const noValue=scoreMarket({...market,yes_ask_dollars:'0.9000',no_ask_dollars:'0.9000'},[event],
    {now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.ok(noValue.best?.netEdge<0);
  assert.equal(noValue.best.size.contracts,0);
  assert.equal(noValue.best.oneContractFee,0.01);
  assert.ok(noValue.best.reasons.includes('Net edge below threshold'));
  assert.ok(!noValue.best.reasons.some(r=>r.includes('afford')||r.includes('Kelly allocation')));
});

test('scan diagnostics distinguish positive estimates from fully eligible signals',()=>{
  const eligible=scoreMarket(market,[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  const gap=scoreMarket({...market,occurrence_datetime:'2026-10-11T20:00:00Z'},[event],
    {now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  const negative=scoreMarket({...market,yes_ask_dollars:'0.9000',no_ask_dollars:'0.9000'},[event],
    {now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  const summary=summarizeScan([eligible,gap,negative,scoreMarket(market,[],{now})]);
  assert.equal(summary.modeled,3);
  assert.equal(summary.qualified,1);
  assert.equal(summary.aboveThreshold,2);
  assert.equal(summary.positiveNet,2);
  assert.ok(summary.blockedReasons.some(x=>x.reason.includes('kickoff times')&&x.count===1));
  assert.ok(summary.blockedReasons.some(x=>x.reason==='Net edge below threshold'&&x.count===1));
});
