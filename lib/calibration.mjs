/** Leakage-aware experimental EPA/Elo calibration.
 * Learn from 2023-24 only. Evaluate on untouched 2025 games. Research only.
 * Sportsbook historical line collection time is not verified.
 */
import { noVigTwoWay } from './finance.mjs';
import { verifyNflKickoff, timeInEastern } from './reference.mjs';
import { TEAMS } from './teams.mjs';

const alias = code => code === 'LA' ? 'LAR' : code === 'JAC' ? 'JAX' : code;
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
const validScore = g => Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore);
const result = g => g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : .5;
const safeP = p => Math.max(.001, Math.min(.999, p));

function teamForm(rows=[]) {
  if (!rows.length) return null;
  const recent=rows.slice(-8); let off=0,allow=0,total=0;
  for(let i=0;i<recent.length;i++){
    const w=.84**(recent.length-1-i); off+=recent[i].off*w;allow+=recent[i].allowed*w;total+=w;
  }
  const shrink=Math.min(1,recent.length/(recent.length+5));
  return {off:off/total*shrink, allowed:allow/total*shrink, games:rows.length};
}
function features(game,ratings,history) {
  const home=alias(game.home),away=alias(game.away);
  const h=teamForm(history.get(home)), a=teamForm(history.get(away));
  if(!h||!a||h.games<4||a.games<4) return null;
  const homeField=game.neutral?0:45;
  const eloLogit=Math.log(10)*((ratings.get(home)??1500)-(ratings.get(away)??1500)+homeField)/400;
  const epaLogit=3.5*((h.off-a.allowed)-(a.off-h.allowed))+(game.neutral?0:.1);
  return {eloLogit, epaLogit, home, away};
}
/** One prediction snapshot per game, before incorporating ANY games from its date.
 * Preserves calendar-day grouping to prevent same-day result leakage.
 */
export function chronologicalFeatures(weeks=[],games=[],asOf=new Date()) {
  const until=timeInEastern(new Date(asOf).toISOString())?.day;
  if(!until) throw new Error('Invalid calibration as-of date');
  const pairs=new Map();
  for(const row of weeks){
    if(!row?.gameId||!row.team||!row.opponent||!Number.isFinite(row.rate))continue;
    if(!pairs.has(row.gameId))pairs.set(row.gameId,new Map());
    pairs.get(row.gameId).set(alias(row.team),row);
  }
  const ratings=new Map(),history=new Map(),samples=[];
  let currentSeason=null,latestEpaDay=null;
  const sorted=[...games].filter(g=>g?.day&&g.day<until).sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
  let ix=0;
  while(ix<sorted.length){
    const day=sorted[ix].day, group=[];
    while(ix<sorted.length&&sorted[ix].day===day)group.push(sorted[ix++]);
    for(const game of group){
      if(currentSeason!==game.season){
        if(currentSeason!==null) for(const [team,r] of ratings) ratings.set(team,1500+(r-1500)*2/3);
        currentSeason=game.season;
      }
    }
    // Predict all games scheduled for the date BEFORE incorporating results from any of them.
    for(const game of group){
      if(!['REG','WC','DIV','CON','SB','POST'].includes(game.gameType)||!validScore(game))continue;
      const f=features(game,ratings,history);
      if(!f)continue;
      const odds=Number.isFinite(game.homeLine)&&Number.isFinite(game.awayLine)?noVigTwoWay(game.homeLine,game.awayLine):null;
      samples.push({gameId:game.id,day,season:game.season,y:result(game),...f,
        bookP:odds?.[0]??null,neutral:game.neutral});
    }
    // Only after predictions, incorporate final scores and paired weekly EPA.
    for(const game of group){
      if(!['REG','WC','DIV','CON','SB','POST'].includes(game.gameType)||!validScore(game))continue;
      const home=alias(game.home),away=alias(game.away),rh=ratings.get(home)??1500,ra=ratings.get(away)??1500;
      const p=sigmoid(Math.log(10)*(rh-ra+(game.neutral?0:45))/400);
      const diff=20*(result(game)-p);
      ratings.set(home,rh+diff);ratings.set(away,ra-diff);
      const pair=pairs.get(game.id),h=pair?.get(home),a=pair?.get(away);
      if(h&&a&&alias(h.opponent)===away&&alias(a.opponent)===home&&h.season===game.season&&a.season===game.season&&h.week===a.week){
        if(!history.has(home))history.set(home,[]);
        if(!history.has(away))history.set(away,[]);
        history.get(home).push({off:h.rate,allowed:a.rate});
        history.get(away).push({off:a.rate,allowed:h.rate});
        latestEpaDay=day;
      }
    }
  }
  if(currentSeason!==null && new Date(asOf).getUTCFullYear()>currentSeason){
    for(const [team,r] of ratings) ratings.set(team,1500+(r-1500)*2/3);
  }
  return {samples, ratings, history,latestEpaDay};
}

function predict(coefficients,s,useEPA){
  return sigmoid(coefficients[0]+coefficients[1]*s.eloLogit+(useEPA?coefficients[2]*s.epaLogit:0));
}
export function fitLogistic(samples,useEPA=false){
  if(!Array.isArray(samples)||samples.length<50)return null;
  const coeff=[0,1,0],lambda=.012,step=.2;
  // Fixed regularization and learning schedule; not tuned using the 2025 holdout.
  for(let k=0;k<1000;k++){
    const grad=[0,0,0];
    for(const s of samples){
      const err=predict(coeff,s,useEPA)-s.y;
      grad[0]+=err;grad[1]+=err*s.eloLogit;
      if(useEPA)grad[2]+=err*s.epaLogit;
    }
    coeff[0]-=step*grad[0]/samples.length;
    coeff[1]-=step*(grad[1]/samples.length+lambda*(coeff[1]-1));
    if(useEPA)coeff[2]-=step*(grad[2]/samples.length+lambda*coeff[2]);
  }
  return coeff.map(x=>Math.round(x*1e6)/1e6);
}
function metrics(samples,pred){
  if(!samples.length)return null;
  let brier=0,logloss=0;
  const bins=Array.from({length:5},(_,i)=>({range:`${i*20}-${(i+1)*20}%`,n:0,forecast:0,actual:0}));
  const errors=[];
  for(const s of samples){
    const p=safeP(pred(s));
    const error=(p-s.y)**2;
    brier+=error;logloss-=s.y*Math.log(p)+(1-s.y)*Math.log(1-p);
    errors.push(error);
    const bucket=bins[Math.min(4,Math.floor(p*5))];bucket.n++;bucket.forecast+=p;bucket.actual+=s.y;
  }
  return {games:samples.length,brier:brier/samples.length,logLoss:logloss/samples.length,
    calibration:bins.filter(b=>b.n>0).map(b=>({range:b.range,n:b.n,forecast:b.forecast/b.n,actual:b.actual/b.n})),errors};
}
export function buildCalibrationLab(weeks,games,asOf=new Date(),trainSeasons=[2023,2024],holdoutSeason=2025){
  const f=chronologicalFeatures(weeks,games,asOf);
  const withBooks=f.samples.filter(s=>Number.isFinite(s.bookP));
  const train=withBooks.filter(s=>trainSeasons.includes(s.season));
  const test=withBooks.filter(s=>s.season===holdoutSeason);
  const eloFit=fitLogistic(train,false),jointFit=fitLogistic(train,true);
  const available=!!eloFit&&!!jointFit&&test.length>0;
  const baseline=available?metrics(test,s=>sigmoid(s.eloLogit)):null;
  const calibratedElo=available?metrics(test,s=>predict(eloFit,s,false)):null;
  const calibratedJoint=available?metrics(test,s=>predict(jointFit,s,true)):null;
  const epa=available?metrics(test,s=>sigmoid(s.epaLogit)):null;
  const books=available?metrics(test,s=>s.bookP):null;
  const diff=available?calibratedJoint.errors.map((x,i)=>x-books.errors[i]):[];
  const avg=diff.reduce((a,b)=>a+b,0)/(diff.length||1);
  const variance=diff.length>1?diff.reduce((a,v)=>a+(v-avg)**2,0)/(diff.length-1):0;
  const uncertainty=diff.length>1?1.96*Math.sqrt(variance/diff.length):null;
  const compact=m=>m?{games:m.games,brier:m.brier,logLoss:m.logLoss,calibration:m.calibration}:null;
  return {trainingSeasons:[...trainSeasons],holdoutSeason,trainingGames:train.length,testGames:test.length,
    available,trainedElo:eloFit,trainedEloEpa:jointFit,
    holdout:{sportsbook:compact(books),elo:compact(baseline),calibratedElo:compact(calibratedElo),
      calibratedEloEpa:compact(calibratedJoint),epaProxy:compact(epa)},
    differenceVsBooks:available?{meanBrierDifference:avg,approx95Low:avg-uncertainty,approx95High:avg+uncertainty}:null,
    lastEpaGame:f.latestEpaDay,live:{ratings:f.ratings,history:f.history}};
}
export function calibratedForMatch(auto,games,lab){
  if(!auto||!lab?.available||!lab?.trainedEloEpa||!lab?.live)return null;
  const verified=verifyNflKickoff(auto,games);
  if(!verified?.verified)return null;
  const match=games.find(g=>g.id===verified.gameId);
  if(!match)return null;
  const latest=Date.parse(`${lab.lastEpaGame||''}T12:00:00Z`),kick=Date.parse(auto.commenceTime);
  if(!Number.isFinite(latest)||!Number.isFinite(kick)||kick-latest<0||kick-latest>21*86400_000)return null;
  const f=features(match,lab.live.ratings,lab.live.history);
  if(!f)return null;
  const p=predict(lab.trainedEloEpa,f,true);
  const chosen=auto.selectionTeam===auto.homeTeam?p:1-p;
  return {probability:chosen,deltaFromBooks:chosen-auto.probability,
    source:'Experimental 2023-24-fitted Elo + EPA calibration',
    disclaimer:'2025 holdout is diagnostic only; model is not validated as a profitable trading signal'};
}
