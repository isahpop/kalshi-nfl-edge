import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNflverseGames} from './reference.mjs';
import {parseWeeklyEpaCsv} from './epa.mjs';
import {chronologicalFeatures,fitLogistic,buildCalibrationLab,calibratedForMatch} from './calibration.mjs';
const gameHeader='game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,home_moneyline,away_moneyline';
const statHeader='season,week,season_type,game_id,team,opponent_team,passing_epa,rushing_epa,attempts,sacks_suffered,carries';
function fixtures(){
  const games=[gameHeader],weeks={2023:[statHeader],2024:[statHeader],2025:[statHeader]};
  const pairs=[['ARI','ATL'],['BAL','BUF'],['CAR','CHI'],['CIN','CLE']];
  for(let year=2023;year<=2025;year++)for(let week=1;week<=17;week++){
    const date=new Date(Date.UTC(year,8,3+(week-1)*7)).toISOString().slice(0,10);
    for(const [i,[home,away]] of pairs.entries()){
      const id=`${year}_${String(week).padStart(2,'0')}_${away}_${home}`;
      const homeWins=(week+i+year)%3!==0;
      games.push(`${id},${year},REG,${week},${date},13:00,${away},${homeWins?17:24},${home},${homeWins?24:17},Home,-140,120`);
      weeks[year].push(`${year},${week},REG,${id},${home},${away},${homeWins?12:-8},3,30,2,25`);
      weeks[year].push(`${year},${week},REG,${id},${away},${home},${homeWins?-8:12},2,30,2,25`);
    }
  }
  return {games:parseNflverseGames(games.join('\n')),weeks:Object.keys(weeks).flatMap(y=>parseWeeklyEpaCsv(weeks[y].join('\n'),Number(y)))};
}
const asOf=new Date('2026-10-08T20:00:00Z');
test('calibration trains on 2023–24 only and compares same 2025 holdout games',()=>{
  const f=fixtures(),lab=buildCalibrationLab(f.weeks,f.games,asOf);
  assert.equal(lab.available,true);
  assert.ok(lab.trainingGames>50);
  assert.ok(lab.testGames>40);
  assert.equal(lab.holdout.elo.games,lab.holdout.calibratedEloEpa.games);
  assert.equal(lab.holdout.sportsbook.games,lab.holdout.calibratedEloEpa.games);
  for(const metric of Object.values(lab.holdout)){
    assert.ok(metric.brier>=0&&metric.brier<=1);
    assert.ok(metric.logLoss>=0);
    assert.equal(metric.calibration.reduce((n,b)=>n+b.n,0),lab.testGames);
  }
});
test('changed holdout outcomes do not change fitted training coefficients',()=>{
  const f=fixtures(),initial=buildCalibrationLab(f.weeks,f.games,asOf);
  const changed=f.games.map(g=>g.season===2025?{...g,homeScore:g.awayScore,awayScore:g.homeScore}:g);
  const updated=buildCalibrationLab(f.weeks,changed,asOf);
  assert.deepEqual(updated.trainedElo,initial.trainedElo);
  assert.deepEqual(updated.trainedEloEpa,initial.trainedEloEpa);
});
test('same-day Elo predictions do not incorporate results from other same-day games',()=>{
  const f=fixtures(),samples=chronologicalFeatures(f.weeks,f.games,asOf).samples;
  const day=samples.find(x=>x.day.startsWith('2025-'))?.day;
  const today=samples.filter(x=>x.day===day);
  assert.ok(today.length>=3);
  const modified=f.games.map(g=>g.day===day?{...g,homeScore:99-g.homeScore,awayScore:99-g.awayScore}:g);
  const later=chronologicalFeatures(f.weeks,modified,asOf).samples.filter(x=>x.day===day);
  assert.deepEqual(today.map(x=>[x.eloLogit,x.epaLogit]),later.map(x=>[x.eloLogit,x.epaLogit]));
});
test('insufficient training data never fabricates fitted model',()=>{
  const f=fixtures();const testOnly=f.games.filter(g=>g.season===2025);
  const lab=buildCalibrationLab(f.weeks,testOnly,asOf);
  assert.equal(lab.available,false);
  assert.equal(lab.trainedEloEpa,null);
});
test('current live calibration requires exact schedule confirmation and recently completed EPA',()=>{
  const f=fixtures();const lab=buildCalibrationLab(f.weeks,f.games,asOf);
  const event={homeTeam:'Arizona Cardinals',awayTeam:'Atlanta Falcons',selectionTeam:'Arizona Cardinals',commenceTime:'2026-10-11T17:00:00Z',probability:.6};
  // Fixture contains no upcoming scheduled game, so the model must refuse to infer a matchup.
  assert.equal(calibratedForMatch(event,f.games,lab),null);
});
test('fitted probabilities are finite and the coefficients cannot be driven by any test-year outcome',()=>{
  const result=fitLogistic(Array.from({length:60},(_,i)=>({eloLogit:(i%5-2)/4,epaLogit:(i%3-1)/4,y:i%2})),true);
  assert.equal(result.length,3);assert.ok(result.every(Number.isFinite));
});
test('trained live forecast uses confirmed kickoff and current EPA without changing bookmaker probability',()=>{
  const f=fixtures();
  const baseId='2026_05_ATL_ARI';
  f.games.push({id:'2026_04_ATL_ARI',season:2026,gameType:'REG',week:4,day:'2026-10-04',time:'13:00',away:'ATL',home:'ARI',awayScore:17,homeScore:24,homeLine:-140,awayLine:120,neutral:false});
  f.games.push({id:baseId,season:2026,gameType:'REG',week:5,day:'2026-10-11',time:'13:00',away:'ATL',home:'ARI',awayScore:null,homeScore:null,homeLine:null,awayLine:null,neutral:false});
  f.weeks.push({gameId:'2026_04_ATL_ARI',season:2026,week:4,team:'ARI',opponent:'ATL',rate:.2});
  f.weeks.push({gameId:'2026_04_ATL_ARI',season:2026,week:4,team:'ATL',opponent:'ARI',rate:-.1});
  const lab=buildCalibrationLab(f.weeks,f.games,asOf);
  const auto={homeTeam:'Arizona Cardinals',awayTeam:'Atlanta Falcons',selectionTeam:'Arizona Cardinals',commenceTime:'2026-10-11T17:00:00Z',probability:.6};
  const candidate=calibratedForMatch(auto,f.games,lab);
  assert.ok(candidate,'EPA history is available through Oct 4');
  assert.ok(candidate.probability>0&&candidate.probability<1);
  assert.equal(candidate.deltaFromBooks,candidate.probability-auto.probability);
  assert.equal(calibratedForMatch({...auto,commenceTime:'2026-10-11T18:00:00Z'},f.games,lab),null,'wrong kickoff is rejected');
});
