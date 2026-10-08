import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvLine, parseNflverseGames, timeInEastern, verifyNflKickoff, buildEloReference, eloForMatch } from './reference.mjs';
import { scoreMarket } from './engine.mjs';
const fixture=`game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,home_moneyline,away_moneyline
2024_01_DET_ARI,2024,REG,1,2024-09-08,16:25,DET,25,ARI,10,Home,-130,110
2025_01_DET_ARI,2025,REG,1,2025-09-07,16:25,DET,30,ARI,10,Home,110,-130
2026_05_DET_ARI,2026,REG,5,2026-10-11,16:25,DET,,ARI,,Home,-200,165
2026_06_ARI_DET,2026,REG,6,2026-10-18,16:25,ARI,,DET,,Home,-200,165`;
const games=parseNflverseGames(fixture);
const event={
  id:'live', home_team:'Arizona Cardinals', away_team:'Detroit Lions',
  commence_time:'2026-10-11T20:25:00Z',
  bookmakers:['dk','fd','mgm'].map(key=>({
    key, markets:[{key:'h2h',last_update:'2026-10-08T19:00:00Z',
      outcomes:[{name:'Arizona Cardinals',price:210},{name:'Detroit Lions',price:-258}]}]
  }))
};
const market={ticker:'KXNFLGAME-26OCT11DETARI-DET',event_ticker:'KXNFLGAME-26OCT11DETARI',status:'active',title:'Detroit wins',yes_sub_title:'Detroit',occurrence_datetime:'2026-10-11T23:25:00Z',yes_ask_dollars:'0.55',yes_bid_dollars:'0.54',yes_ask_size_fp:'100',no_ask_dollars:'0.46',no_bid_dollars:'0.45',no_ask_size_fp:'100'};
const now=Date.parse('2026-10-08T19:05:00Z');
test('RFC4180-like CSV field parsing handles quoted commas and escaped quotes',()=>{
  assert.deepEqual(parseCsvLine('a,"b,c","d""e"'),['a','b,c','d"e']);
});
test('schedule uses actual nflverse game fields and does not invent final scores',()=>{
  assert.equal(games.length,4);
  assert.equal(games[2].homeScore,null);
  assert.equal(games[2].awayScore,null);
  assert.equal(games[2].time,'16:25');
});
test('Eastern kickoff accounts for daylight savings (summer and winter)',()=>{
  assert.deepEqual(timeInEastern('2026-10-11T20:25:00Z'),{day:'2026-10-11',minute:985});
  assert.deepEqual(timeInEastern('2026-12-06T21:25:00Z'),{day:'2026-12-06',minute:985});
});
test('official schedule validates sportsbook kickoff despite Kalshi 3-hour completion estimate',()=>{
  const model=buildEloReference(games,new Date(now));
  const context={games,model};
  const result=scoreMarket(market,[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true,reference:context});
  assert.equal(result.auto.kickoffGapMinutes,180);
  assert.equal(result.reference.schedule.verified,true);
  assert.equal(result.reference.schedule.gameId,'2026_05_DET_ARI');
  assert.ok(result.reference.elo);
  assert.ok(!result.best.reasons.some(reason=>reason.includes('kickoff times disagree')));
  assert.equal(result.qualified,true,'a fresh, economically attractive schedule-verified market can qualify');
});
test('no nflverse schedule or wrong kickoff preserves the 180-minute safety gate',()=>{
  const model=buildEloReference(games,new Date(now));
  const noSchedule=scoreMarket(market,[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true,reference:{games:[],model}});
  assert.ok(noSchedule.best.reasons.some(reason=>reason.includes('schedule not independently verified')));
  const wrongEvent={...event,commence_time:'2026-10-11T21:25:00Z'};
  const wrong=scoreMarket(market,[wrongEvent],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true,reference:{games,model}});
  assert.equal(wrong.reference.schedule.verified,false);
  assert.equal(wrong.reference.schedule.deltaMinutes,60);
  assert.ok(wrong.best.reasons.some(reason=>reason.includes('schedule not independently verified')));
});
test('home and away orientation must match the schedule',()=>{
  assert.equal(verifyNflKickoff({...event,homeTeam:'Detroit Lions',awayTeam:'Arizona Cardinals'},games),null);
  assert.equal(verifyNflKickoff({homeTeam:'Arizona Cardinals',awayTeam:'Detroit Lions',commenceTime:'2026-10-11T20:25:00Z'},games)?.verified,true);
});
test('Elo training ignores future incomplete games and produces finite unbiased probabilities',()=>{
  const model=buildEloReference(games,new Date('2026-10-08T20:00:00Z'));
  assert.equal(model.processed,2);
  assert.equal(model.evaluation.year,2025);
  assert.equal(model.evaluation.games,1);
  assert.ok(model.evaluation.brier>=0&&model.evaluation.brier<=1);
  assert.ok(model.ratings.get('DET')>model.ratings.get('ARI'));
  const result=eloForMatch({homeTeam:'Arizona Cardinals',awayTeam:'Detroit Lions',selectionTeam:'Detroit Lions',commenceTime:'2026-10-11T20:25:00Z',probability:0.7},games,model);
  assert.ok(result.elo.probability>0&&result.elo.probability<1);
  assert.ok(Math.abs(result.elo.deltaFromBooks)>0);
});
test('independent reference cannot override sportsbook fair probability or manufacture a signal',()=>{
  const model=buildEloReference(games,new Date(now));
  const result=scoreMarket({...market,yes_ask_dollars:'0.99',no_ask_dollars:'0.99'},[event],{now,snapshotAt:new Date(now).toISOString(),feeVerified:true,reference:{games,model}});
  assert.equal(result.fair,result.auto.probability);
  assert.ok(result.reference.elo);
  assert.equal(result.qualified,false);
});
