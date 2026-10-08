import test from 'node:test';
import assert from 'node:assert/strict';
import { sportsbookRequestUrl, normalizeSportsGameOdds, FREE_TIER_CACHE_SECONDS, FREE_TIER_MAX_EVENTS } from './sportsgameodds.mjs';
import { consensusForMarket } from './consensus.mjs';
import { scoreMarket } from './engine.mjs';
const now=Date.parse('2026-10-08T19:00:00Z');
const kickoff='2026-10-11T17:00:00Z';
function event(overrides={}) {
  const pair={
    DK:[-120,110],FD:[-125,115],betmgm:[-122,112]
  };
  const mk=(i)=>Object.fromEntries(Object.entries(pair).map(([key, prices])=>[key,{odds:String(prices[i]),available:true,lastUpdatedAt:'2026-10-08T18:55:00Z'}]));
  return {
    eventID:'SGO-001',leagueID:'NFL',status:{startsAt:kickoff,started:false,live:false},
    teams:{home:{names:{long:'Philadelphia Eagles'}},away:{names:{long:'Dallas Cowboys'}}},
    odds:{'points-home-game-ml-home':{byBookmaker:mk(0)},'points-away-game-ml-away':{byBookmaker:mk(1)}},...overrides
  };
}
const kalshi={ticker:'KXNFLGAME-26OCT11DALPHI-DAL',event_ticker:'KXNFLGAME-26OCT11DALPHI',status:'open',title:'Dallas Cowboys at Philadelphia Eagles',yes_sub_title:'Dallas Cowboys',expected_expiration_time:kickoff,yes_ask_dollars:'0.35',yes_bid_dollars:'0.33',no_ask_dollars:'0.67',no_bid_dollars:'0.65',yes_ask_size_fp:'15',no_ask_size_fp:'15'};
test('Amateur requests exactly NFL pregame moneylines, bounded future window, 20 event maximum',()=>{
  const url=sportsbookRequestUrl(now);
  assert.equal(url.origin,'https://api.sportsgameodds.com');
  assert.equal(url.searchParams.get('leagueID'),'NFL');
  assert.equal(url.searchParams.get('oddID'),'points-home-game-ml-home,points-away-game-ml-away');
  assert.equal(url.searchParams.get('limit'),String(FREE_TIER_MAX_EVENTS));
  assert.equal(url.searchParams.get('started'),'false');
  assert.equal(url.searchParams.get('oddsAvailable'),'true');
  assert.equal(url.searchParams.get('apiKey'),null);
  assert.equal(FREE_TIER_CACHE_SECONDS,28800);
});
test('free-tier endpoint URL is stable within each eight-hour cache window',()=>{
  const first=sportsbookRequestUrl(now).toString();
  assert.equal(sportsbookRequestUrl(now + 60000).toString(),first);
  assert.equal(sportsbookRequestUrl(now + 3599000).toString(),first);
  assert.notEqual(sportsbookRequestUrl(now + 8*3600000).toString(),first);
});
test('Normalize paired sportsbook odds and generate strictly independent fair probability',()=>{
  const events=normalizeSportsGameOdds([event()],now);
  assert.equal(events.length,1);
  assert.equal(events[0].bookmakers.length,3);
  const model=consensusForMarket(kalshi,events,{now});
  assert.equal(model.books,3);
  assert.ok(model.probability>.45&&model.probability<.48,JSON.stringify(model));
  const scored=scoreMarket(kalshi,events,{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.ok(scored.auto);assert.equal(scored.best.side,'YES');assert.equal(scored.qualified,true);
});
test('Reject unavailable, mismatched, missing and non-moneyline sportsbook quotes',()=>{
  const e=event();
  e.odds['points-away-game-ml-away'].byBookmaker.FD.available=false;
  e.odds['points-away-game-ml-away'].byBookmaker.DK.odds='invalid';
  e.odds['points-away-game-ml-away'].byBookmaker.betmgm.lastUpdatedAt='2026-10-08T15:00:00Z';
  assert.equal(normalizeSportsGameOdds([e],now)[0].bookmakers.length,0);
  assert.equal(normalizeSportsGameOdds([event({odds:{'points-all-game-ou-over':{}}})],now).length,0);
});
test('Reject games already started, non-NFL and invalid team identities',()=>{
  assert.equal(normalizeSportsGameOdds([event({leagueID:'NCAAF'})],now).length,0);
  assert.equal(normalizeSportsGameOdds([event({status:{startsAt:kickoff,started:true}})],now).length,0);
  assert.equal(normalizeSportsGameOdds([event({teams:{}})],now).length,0);
  assert.equal(normalizeSportsGameOdds([event({status:{startsAt:'2026-10-07T20:00:00Z'}})],now).length,0);
});
test('Deduplicate duplicate events and keep fewer than 3 paired books unmodeled',()=>{
  const e=event();
  delete e.odds['points-home-game-ml-home'].byBookmaker.DK;
  assert.equal(normalizeSportsGameOdds([e,e],now).length,1);
  assert.equal(consensusForMarket(kalshi,normalizeSportsGameOdds([e],now),{now}),null);
});
test('Retain cache-aged odds for research but never mark as qualified when stale',()=>{
  const e=event();
  for(const side of Object.values(e.odds))for(const b of Object.values(side.byBookmaker)) b.lastUpdatedAt='2026-10-08T15:00:00Z';
  const scored=scoreMarket(kalshi,normalizeSportsGameOdds([e],now),{now,snapshotAt:new Date(now).toISOString(),feeVerified:true});
  assert.ok(scored.auto);assert.equal(scored.qualified,false);
  assert.match(scored.best.reasons.join(' '),/older than 60 minutes/);
});
