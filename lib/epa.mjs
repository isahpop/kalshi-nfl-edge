/** nflverse weekly-team-stat EPA proxy. Research only, never qualifies trades.
 * NFLverse weekly stats report summed team passing QB-EPA and rushing EPA;
 * dividing by attempts+sacks+carries approximates but does NOT exactly
 * reproduce nflfastR play-level offense EPA/play or defensive success rate.
 */
import { TEAMS } from './teams.mjs';
import { parseCsvLine, timeInEastern, verifyNflKickoff } from './reference.mjs';
import { noVigTwoWay } from './finance.mjs';

export const EPA_SEASONS = [2023,2024,2025,2026];
export const EPA_CACHE_SECONDS = 12*3600;
export const epaUrl = year => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${year}.csv`;
const validNum = value => value!==''&&value!=null&&Number.isFinite(Number(value)) ? Number(value) : null;
const codeAlias = {JAC:'JAX',LA:'LAR',WAS:'WAS',LAR:'LAR',JAX:'JAX'};
const normalized = code => codeAlias[code]||code;
const clamp = (x,min,max) => Math.min(max,Math.max(min,x));
const sigmoid = z => 1/(1+Math.exp(-z));
const eloProbability = diff => 1/(1+10**(-diff/400));

/** Validate schema and use no fabricated EPA when required fields are absent. */
export function parseWeeklyEpaCsv(csv, expectedSeason) {
  if(typeof csv!=='string'||csv.length>12_000_000)throw new Error('Weekly EPA CSV missing or exceeds size limit');
  const [headerRow,...lines]=csv.trim().split(/\r?\n/);
  const h=parseCsvLine(headerRow||'');
  const ix=Object.fromEntries(h.map((v,i)=>[v.trim(),i]));
  const columns=['season','week','team','opponent_team','game_id','passing_epa','rushing_epa','attempts','sacks_suffered','carries','season_type'];
  if(columns.some(k=>ix[k]===undefined))throw new Error('Weekly EPA schema does not contain required fields');
  const output=[],seen=new Set();
  for(const line of lines){
    if(!line.trim())continue;
    const row=parseCsvLine(line);const value=k=>row[ix[k]]??'';
    const season=Number(value('season')),week=Number(value('week'));
    const team=normalized(value('team')),opponent=normalized(value('opponent_team'));
    const id=value('game_id');
    if(season!==expectedSeason||!Number.isInteger(week)||week<1||week>25||!id||!TEAMS.some(t=>normalized(t[1])===team)||!TEAMS.some(t=>normalized(t[1])===opponent)||team===opponent||!['REG','POST'].includes(value('season_type')))continue;
    const passing=validNum(value('passing_epa')),rushing=validNum(value('rushing_epa'));
    const attempts=validNum(value('attempts')),sacks=validNum(value('sacks_suffered')),carries=validNum(value('carries'));
    const plays=attempts===null||sacks===null||carries===null?0:attempts+sacks+carries;
    if(passing===null||rushing===null||!Number.isFinite(plays)||plays<20||plays>160)continue;
    // Truncate outlying totals that indicate malformed rows; let legitimate
    // extremes flow through the model's bounded rating conversion.
    if(Math.abs(passing)>150||Math.abs(rushing)>150)continue;
    const key=`${id}|${team}`;
    if(seen.has(key))continue;seen.add(key);
    output.push({gameId:id,season,week,team,opponent,plays,epa:passing+rushing,rate:(passing+rushing)/plays});
  }
  return output;
}

async function fetchSeason(year){
  const response=await fetch(epaUrl(year),{next:{revalidate:EPA_CACHE_SECONDS},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Weekly EPA ${year} HTTP ${response.status}`);
  return parseWeeklyEpaCsv(await response.text(),year);
}
/** Partial coverage is marked and never quietly treated as full-season input. */
export async function fetchWeeklyEpaReference() {
  const results=await Promise.allSettled(EPA_SEASONS.map(fetchSeason));
  const weeks=[],unavailable=[];
  results.forEach((r,i)=>r.status==='fulfilled'?weeks.push(...r.value):unavailable.push(`${EPA_SEASONS[i]}: ${String(r.reason?.message||'unavailable')}`));
  if(weeks.length<300)throw new Error('Insufficient weekly EPA history; '+unavailable.join('; '));
  return {weeks,availableSeasons:EPA_SEASONS.filter(y=>!unavailable.some(e=>e.startsWith(`${y}:`))),unavailable};
}

const currentStats = (rows,limit=8) => {
  if(!rows?.length)return null;
  // Weight recent games more heavily; shrink early-season extremes to mean 0.
  const recent=rows.slice(-limit);
  let off=0,allowed=0,weight=0;
  for(let i=0;i<recent.length;i++){
    const w=Math.pow(0.84,recent.length-1-i);
    off+=w*recent[i].off;allowed+=w*recent[i].allowed;weight+=w;
  }
  const shrink=Math.min(1,recent.length/(recent.length+5));
  const offense=clamp((off/weight)*shrink,-0.55,0.55);
  const defenseAllowed=clamp((allowed/weight)*shrink,-0.55,0.55);
  return {offense,defenseAllowed,net:offense-defenseAllowed,games:rows.length,season:recent.at(-1).season};
};
const eloUpdate = (ratings,home,away,homePts,awayPts,homeField=45) => {
  const rh=ratings.get(home)??1500,ra=ratings.get(away)??1500;
  const p=eloProbability(rh-ra+homeField);
  const actual=homePts>awayPts?1:homePts<awayPts?0:.5;
  const change=20*(actual-p);
  ratings.set(home,rh+change);ratings.set(away,ra-change);
  return {p,actual};
};
/** Game-by-game walk-forward: predict BEFORE adding that game's EPA/score.
 * Book benchmark is a pregame moneyline of unverified collection timestamp.
 * Holdout year is NOT used for parameter fitting.
 */
export function buildEpaReference(weeks,games,asOf=new Date(),testSeason=2025){
  const date=new Date(asOf);if(!Number.isFinite(+date))throw new Error('Invalid as-of time');
  const todayET=timeInEastern(date.toISOString())?.day;
  const index=new Map();
  for(const r of weeks||[]){
    if(!r||r.gameId==null||typeof r.team!=='string'||!Number.isFinite(r.rate))continue;
    if(!index.has(r.gameId))index.set(r.gameId,new Map());
    index.get(r.gameId).set(normalized(r.team),r);
  }
  const history=new Map(),ratings=new Map();
  let season=null,processed=0,epaGames=0,lastDay=null;
  const stats={games:0,epaError:0,eloError:0,blendError:0,bookError:0,actualUpset:0};
  for(const game of games||[]){
    if(game.day>=todayET||game.homeScore==null||game.awayScore==null||!Number.isFinite(game.homeScore)||!Number.isFinite(game.awayScore))continue;
    const home=normalized(game.home),away=normalized(game.away);
    if(game.season!==season){
      if(season!==null){for(const [t,v] of ratings)ratings.set(t,1500+(v-1500)*2/3);}
      season=game.season;
    }
    const rh=ratings.get(home)??1500,ra=ratings.get(away)??1500;
    const homeField=game.neutral?0:45;
    const eloP=eloProbability(rh-ra+homeField);
    const h=currentStats(history.get(home)),a=currentStats(history.get(away));
    // Offense minus opponent's defensive EPA allowed. 3.5 is an uncalibrated
    // bounded heuristic conversion from EPA/approx-play to win probability.
    const epaP=h?.games>=4&&a?.games>=4?sigmoid(clamp(3.5*((h.offense-a.defenseAllowed)-(a.offense-h.defenseAllowed))+(game.neutral?0:.10),-4,4)):null;
    if(game.season===testSeason&&epaP!==null&&game.homeLine!=null&&game.awayLine!=null){
      const book=noVigTwoWay(game.homeLine,game.awayLine);
      if(book){
        const actual=game.homeScore>game.awayScore?1:game.homeScore<game.awayScore?0:.5;
        stats.epaError+=(epaP-actual)**2;
        stats.eloError+=(eloP-actual)**2;
        stats.blendError+=((epaP+eloP)/2-actual)**2;
        stats.bookError+=(book[0]-actual)**2;
        stats.games++;
      }
    }
    // Do not train EPA on synthetic scores or incomplete/missing team stat rows.
    const pair=index.get(game.id);
    const homeEpa=pair?.get(home),awayEpa=pair?.get(away);
    if(homeEpa&&awayEpa&&homeEpa.opponent===away&&awayEpa.opponent===home&&homeEpa.week===awayEpa.week){
      if(!history.has(home))history.set(home,[]);
      if(!history.has(away))history.set(away,[]);
      history.get(home).push({off:homeEpa.rate,allowed:awayEpa.rate,season:game.season});
      history.get(away).push({off:awayEpa.rate,allowed:homeEpa.rate,season:game.season});
      processed++;lastDay=game.day;
    }
    eloUpdate(ratings,home,away,game.homeScore,game.awayScore,homeField);
  }
  if(season!==null&&date.getUTCFullYear()>season){for(const [t,v] of ratings)ratings.set(t,1500+(v-1500)*2/3);}
  const teamRatings=new Map([...history].map(([team,rows])=>[team,currentStats(rows)]));
  const summary= {year:testSeason,games:stats.games,
    epaBrier:stats.games?stats.epaError/stats.games:null,
    eloBrier:stats.games?stats.eloError/stats.games:null,
    blendBrier:stats.games?stats.blendError/stats.games:null,
    bookBrier:stats.games?stats.bookError/stats.games:null};
  return {teamRatings,processed,lastDay,summary,epaPresent:processed>0,params:{gamesWindow:8,decay:0.84,shrinkageGames:5,logisticScale:3.5,homeLogit:0.1}};
}

/** Experimental pregame probability: never overrides bookmaker consensus. */
export function epaForMatch(auto,games,model){
  const schedule=verifyNflKickoff(auto,games);
  if(!schedule?.verified||!model?.teamRatings)return null;
  // A missing current season feed must NOT masquerade as a current EPA forecast.
  const last=Date.parse(`${model.lastDay||''}T12:00:00Z`),kickoff=Date.parse(auto.commenceTime||'');
  if(!Number.isFinite(last)||!Number.isFinite(kickoff)||kickoff<last||kickoff-last>21*86400_000)return null;
  const home=normalized(TEAMS.find(t=>t[0]===auto.homeTeam)?.[1]);
  const away=normalized(TEAMS.find(t=>t[0]===auto.awayTeam)?.[1]);
  const h=model.teamRatings.get(home),a=model.teamRatings.get(away);
  if(!h||!a||h.games<4||a.games<4)return null;
  const game=games.find(g=>g.id===schedule.gameId);
  if(!game)return null;
  const pHome=sigmoid(clamp(model.params.logisticScale*((h.offense-a.defenseAllowed)-(a.offense-h.defenseAllowed))+(game.neutral?0:model.params.homeLogit),-4,4));
  const p=auto.selectionTeam===auto.homeTeam?pHome:1-pHome;
  return {probability:p,deltaFromBooks:p-auto.probability,gamesHome:h.games,gamesAway:a.games,
    lastDataDay:model.lastDay,source:'Experimental nflverse weekly EPA proxy',
    disclaimer:'Uncalibrated weekly EPA proxy; does not adjust for confirmed starters, injuries, travel or weather; research only'};
}
