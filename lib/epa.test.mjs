import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyEpaCsv,buildEpaReference,epaForMatch,epaUrl } from './epa.mjs';
import { parseNflverseGames } from './reference.mjs';
import { scoreMarket } from './engine.mjs';

const header='season,week,season_type,game_id,team,opponent_team,passing_epa,rushing_epa,attempts,sacks_suffered,carries';
const gameCsv='game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,home_moneyline,away_moneyline';
const weeks=[], games=[];
// Eight completed games in 2024 and 2025; each match gets two weekly team stats.
for(let y=2024;y<=2025;y++)for(let w=1;w<=8;w++){
  const date=`${y}-09-${String(w).padStart(2,'0')}`;
  const id=`${y}_${String(w).padStart(2,'0')}_DET_ARI`;
  const homeScore=(w%3===0?14:28),awayScore=(w%3===0?24:17);
  games.push(`${id},${y},REG,${w},${date},16:25,DET,${awayScore},ARI,${homeScore},Home,-150,130`);
  weeks.push(`${y},${w},REG,${id},DET,ARI,-10,-2,28,2,28`);
  weeks.push(`${y},${w},REG,${id},ARI,DET,12,3,30,2,30`);
}
const gamesParsed=parseNflverseGames([gameCsv,...games, '2026_05_DET_ARI,2026,REG,5,2026-10-11,16:25,DET,,ARI,,Home,-150,130','2025_09_DET_ARI,2025,REG,9,2025-09-15,16:25,DET,,ARI,,Home,-150,130'].join('\n'));
const weeklyParsed= parseWeeklyEpaCsv([header,...weeks].join('\n'),2025);

test('upstream release URL and required weekly EPA schema use published nflverse columns',()=>{
  assert.match(epaUrl(2025),/stats_team_week_2025.csv$/);
  assert.equal(weeklyParsed.length,16);
  assert.ok(Math.abs(weeklyParsed[0].rate-(-12/58))<1e-10);
});
test('rejects malformed and missing fields rather than fabricating EPA',()=>{
  assert.throws(()=>parseWeeklyEpaCsv('season,week\n2025,3',2025),/schema/);
  const missing=[header, '2025,1,REG,2025_01_DET_ARI,DET,ARI,,0,30,2,30'].join('\n');
  assert.equal(parseWeeklyEpaCsv(missing,2025).length,0);
});
test('weekly season mismatch is ignored and duplicates are suppressed',()=>{
  const lines=[header, ...weeks, weeks.at(-1)].join('\n');
  assert.equal(parseWeeklyEpaCsv(lines,2025).length,16);
  assert.equal(parseWeeklyEpaCsv(lines,2023).length,0);
});
test('missing paired team game stats are excluded from updates',()=>{
  const single=weeklyParsed.filter(x=>x.team==='ARI');
  const model=buildEpaReference(single,gamesParsed,new Date('2026-10-08T20:00:00Z'),2025);
  assert.equal(model.processed,0);
  assert.equal(model.summary.games,0);
});
test('walk-forward model evaluates only 2025 games with enough prior observations',()=>{
  const rows=[...parseWeeklyEpaCsv([header,...weeks].join('\n'),2024),...weeklyParsed];
  const model=buildEpaReference(rows,gamesParsed,new Date('2026-10-08T20:00:00Z'),2025);
  assert.equal(model.processed,16);
  assert.equal(model.summary.year,2025);
  assert.equal(model.summary.games,8);
  for(const name of ['epaBrier','eloBrier','blendBrier','bookBrier']) assert.ok(model.summary[name]>0&&model.summary[name]<1);
  assert.equal(model.teamRatings.get('ARI').games,16);
  const chosen={homeTeam:'Arizona Cardinals',awayTeam:'Detroit Lions',selectionTeam:'Arizona Cardinals',commenceTime:'2025-09-15T20:25:00Z',probability:.6};
  const prediction=epaForMatch(chosen,gamesParsed,model);
  assert.ok(prediction?.probability>0&&prediction?.probability<1);
  assert.ok(prediction.probability >.5,'Arizona stronger in crafted EPA fixture');
  assert.equal(prediction.gamesHome,16);
  // A year-old prior cannot be presented as a live current-season forecast.
  assert.equal(epaForMatch({...chosen,commenceTime:'2026-10-11T20:25:00Z'},gamesParsed,model),null);
});
test('2025 future game results and their weekly stats do not leak into 2025 pregame forecast',()=>{
  const rows=[...parseWeeklyEpaCsv([header,...weeks].join('\n'),2024),...weeklyParsed];
  const early=buildEpaReference(rows,gamesParsed,new Date('2025-09-01T20:00:00Z'),2025);
  assert.equal(early.processed,8);
  assert.equal(early.summary.games,0);
  const later=buildEpaReference(rows,gamesParsed,new Date('2026-10-08T20:00:00Z'),2025);
  assert.equal(later.summary.games,8);
});
test('EPA never overrides consensus nor lifts automatic qualification',()=>{
  const rows=[...parseWeeklyEpaCsv([header,...weeks].join('\n'),2024),...weeklyParsed];
  const model=buildEpaReference(rows,gamesParsed,new Date('2026-10-08T20:00:00Z'),2025);
  const event={id:'ev',home_team:'Arizona Cardinals',away_team:'Detroit Lions',commence_time:'2026-10-11T20:25:00Z',bookmakers:['a','b','c'].map(key=>({key,markets:[{key:'h2h',last_update:'2026-10-08T19:00:00Z',outcomes:[{name:'Arizona Cardinals',price:-150},{name:'Detroit Lions',price:130}]}]}))};
  const market={ticker:'KXNFLGAME-26OCT11DETARI-ARI',event_ticker:'KXNFLGAME-26OCT11DETARI',status:'active',title:'Arizona wins',yes_sub_title:'Arizona',occurrence_datetime:'2026-10-11T23:25:00Z',yes_ask_dollars:'0.99',no_ask_dollars:'0.99',yes_bid_dollars:'0.98',no_bid_dollars:'0.98',yes_ask_size_fp:'100',no_ask_size_fp:'100'};
  const r=scoreMarket(market,[event],{now:Date.parse('2026-10-08T19:05:00Z'),snapshotAt:'2026-10-08T19:05:00Z',feeVerified:true,reference:{games:gamesParsed,model:{ratings:new Map()},epa:model}});
  assert.equal(r.reference.epa,null,'stale historical EPA data must not appear as 2026 data');
  assert.equal(r.reference.blend,null);
  assert.ok(Math.abs(r.fair-r.auto.probability)<1e-12);
  assert.equal(r.qualified,false);
});

test('fresh-season EPA and fixed blend are visible without replacing sportsbook fair odds',()=>{
  const completed=[]; const weekly=[];
  const days=['2026-09-13','2026-09-20','2026-09-27','2026-10-04'];
  days.forEach((day,i)=>{
    const week=i+1,id=`2026_${String(week).padStart(2,'0')}_DET_ARI`;
    completed.push(`${id},2026,REG,${week},${day},16:25,DET,17,ARI,24,Home,-150,130`);
    weekly.push(`2026,${week},REG,${id},ARI,DET,12,3,30,2,30`);
    weekly.push(`2026,${week},REG,${id},DET,ARI,-10,-2,28,2,28`);
  });
  const fixtureGames=parseNflverseGames([gameCsv,...games,...completed,'2026_05_DET_ARI,2026,REG,5,2026-10-11,16:25,DET,,ARI,,Home,-150,130'].join('\n'));
  const rows=[...parseWeeklyEpaCsv([header,...weeks].join('\n'),2024),...weeklyParsed,...parseWeeklyEpaCsv([header,...weekly].join('\n'),2026)];
  const model=buildEpaReference(rows,fixtureGames,new Date('2026-10-08T20:00:00Z'),2025);
  const event={id:'test',home_team:'Arizona Cardinals',away_team:'Detroit Lions',commence_time:'2026-10-11T20:25:00Z',bookmakers:['a','b','c'].map(key=>({key,markets:[{key:'h2h',last_update:'2026-10-08T19:00:00Z',outcomes:[{name:'Arizona Cardinals',price:-150},{name:'Detroit Lions',price:130}]}]}))};
  const market={ticker:'KXNFLGAME-26OCT11DETARI-ARI',event_ticker:'KXNFLGAME-26OCT11DETARI',status:'active',title:'Arizona wins',yes_sub_title:'Arizona',occurrence_datetime:'2026-10-11T23:25:00Z',yes_ask_dollars:'0.99',no_ask_dollars:'0.99',yes_bid_dollars:'0.98',no_bid_dollars:'0.98',yes_ask_size_fp:'100',no_ask_size_fp:'100'};
  const scored=scoreMarket(market,[event],{now:Date.parse('2026-10-08T19:05:00Z'),snapshotAt:'2026-10-08T19:05:00Z',feeVerified:true,reference:{games:fixtureGames,model:{ratings:new Map()},epa:model}});
  assert.ok(scored.reference.epa?.probability>0);
  assert.ok(scored.reference.blend?.probability>0);
  assert.ok(Math.abs(scored.fair-scored.auto.probability)<1e-12);
  assert.equal(scored.qualified,false);
});
