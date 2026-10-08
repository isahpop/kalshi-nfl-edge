/** NFL reference data and an experimental transparent Elo baseline.
 * Source: nflverse/nfldata games.csv (see README for attribution).
 * The baseline is NOT an independently validated betting model.
 */
import { TEAMS } from './teams.mjs';
import { noVigTwoWay } from './finance.mjs';

export const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
export const REFERENCE_CACHE_SECONDS = 6 * 3600;
const TEAM_IDS = Object.fromEntries(TEAMS.map(t => [t[0], t[1]]));
const NFLVERSE_SPECIAL = { LAR:'LA' };
export function nflverseTeamCode(name) {
  const code = TEAM_IDS[name];
  return code ? (NFLVERSE_SPECIAL[code] || code) : null;
}

export function parseCsvLine(line) {
  let quoted = false, field = '', cells = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i+1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { cells.push(field); field = ''; }
    else field += char;
  }
  cells.push(field);
  return cells;
}
export function parseNflverseGames(csv, minSeason = 2022) {
  if (typeof csv !== 'string' || csv.length > 10_000_000) throw new Error('Invalid nflverse CSV size');
  const lines = csv.trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift() || '');
  const ix = Object.fromEntries(header.map((key, i) => [key, i]));
  const fields = ['game_id','season','game_type','week','gameday','gametime','away_team','home_team','away_score','home_score','location','home_moneyline','away_moneyline'];
  if (fields.some(name => ix[name] === undefined)) throw new Error('Unexpected nflverse schedule format');
  const seen = new Set(), out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const val = name => cells[ix[name]] ?? '';
    const year = Number(val('season'));
    const id = val('game_id');
    const day = val('gameday');
    const away = val('away_team'), home = val('home_team');
    if (!id || seen.has(id) || year < minSeason || year > 2100 || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[A-Z]{2,3}$/.test(away) || !/^[A-Z]{2,3}$/.test(home)) continue;
    seen.add(id);
    const safeNum = x => x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
    out.push({ id, season:year, gameType:val('game_type'), week:Number(val('week')),
      day, time:val('gametime'), away, home,
      awayScore:safeNum(val('away_score')), homeScore:safeNum(val('home_score')),
      homeLine:safeNum(val('home_moneyline')), awayLine:safeNum(val('away_moneyline')),
      neutral:val('location') === 'Neutral' });
  }
  return out.sort((a,b) => a.season-b.season || a.day.localeCompare(b.day) || a.week-b.week || a.id.localeCompare(b.id));
}
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
/** Compare against the NFL's scheduled Eastern time; Kalshi occurrence is often a game-end estimate. */
export function timeInEastern(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(+d)) return null;
  const parts = Object.fromEntries(formatter.formatToParts(d).map(p=>[p.type,p.value]));
  return { day:`${parts.year}-${parts.month}-${parts.day}`, minute:Number(parts.hour)*60+Number(parts.minute) };
}
export function verifyNflKickoff(auto, referenceGames = []) {
  if (!auto?.commenceTime || !auto.homeTeam || !auto.awayTeam || !Array.isArray(referenceGames)) return null;
  const home = nflverseTeamCode(auto.homeTeam), away = nflverseTeamCode(auto.awayTeam);
  const when = timeInEastern(auto.commenceTime);
  if (!home || !away || !when) return null;
  const matching = referenceGames.filter(g => g.home===home && g.away===away && g.day===when.day && /^\d{1,2}:\d{2}$/.test(g.time||''));
  if (matching.length !== 1) return null;
  const g=matching[0], [hr,min]=g.time.split(':').map(Number);
  const delta=Math.abs(when.minute-(hr*60+min));
  return { verified:delta<=15, deltaMinutes:delta, gameId:g.id, source:'nflverse community-maintained schedule',
    scheduledDay:g.day, scheduledTimeEt:g.time };
}

const LOG10 = Math.log(10);
const ratingProb = diff => 1 / (1+Math.exp(-LOG10*diff/400));
const normalizeCode = code => code === 'LA'?'LAR':code;
/** Fixed-parameter, pregame-only Elo; no injury, QB, EPA, market-line or weather adjustment. */
export function buildEloReference(games, asOf = new Date(), testSeason = 2025) {
  const now = new Date(asOf); if (!Number.isFinite(+now)) throw new Error('Invalid evaluation time');
  const todayET = timeInEastern(now.toISOString())?.day;
  const ratings = new Map(); let season = null, processed = 0;
  let testGames=0, brier=0, marketGames=0, marketBrier=0, pairedEloBrier=0;
  for (const g of games || []) {
    if (g.season > now.getUTCFullYear() || g.day >= todayET) continue;
    if (g.homeScore === null || g.awayScore === null || !Number.isFinite(g.homeScore) || !Number.isFinite(g.awayScore)) continue;
    const home=normalizeCode(g.home),away=normalizeCode(g.away);
    if (season !== g.season) {
      if (season !== null) for (const [key,rating] of ratings) ratings.set(key,1500+(rating-1500)*2/3);
      season=g.season;
    }
    const rh=ratings.get(home)??1500, ra=ratings.get(away)??1500;
    const homeProbability=ratingProb(rh-ra+(g.neutral?0:45));
    const actual=g.homeScore>g.awayScore?1:g.homeScore<g.awayScore?0:0.5;
    if (g.season === testSeason) {
      brier += (homeProbability-actual)**2; testGames++;
      if (g.homeLine !== null && g.awayLine !== null) {
        const implied = noVigTwoWay(g.homeLine,g.awayLine);
        if (implied) { marketBrier += (implied[0]-actual)**2; pairedEloBrier += (homeProbability-actual)**2; marketGames++; }
      }
    }
    const change=20*(actual-homeProbability);
    ratings.set(home,rh+change); ratings.set(away,ra-change); processed++;
  }
  // Offseason reversion is applied before the first game of a new season,
  // including when no current-season games have been completed yet.
  if (season !== null && now.getUTCFullYear() > season) for(const [key,rating] of ratings) ratings.set(key,1500+(rating-1500)*2/3);
  return {ratings, processed,
    evaluation: {year:testSeason, games:testGames, brier:testGames?brier/testGames:null,
      marketGames,marketBrier:marketGames?marketBrier/marketGames:null, pairedEloBrier:marketGames?pairedEloBrier/marketGames:null},
    params:{homeElo:45,kFactor:20,offseasonCarry:2/3} };
}
export function eloForMatch(auto, games, model) {
  const verified=verifyNflKickoff(auto,games);
  if (!verified?.verified || !model?.ratings) return {schedule:verified, elo:null};
  const home=nflverseTeamCode(auto.homeTeam), away=nflverseTeamCode(auto.awayTeam);
  const fixture=games.find(g=>g.id===verified.gameId);
  if (!fixture) return {schedule:verified,elo:null};
  const homeRating=model.ratings.get(normalizeCode(home))??1500;
  const awayRating=model.ratings.get(normalizeCode(away))??1500;
  const probabilityHome=ratingProb(homeRating-awayRating+(fixture.neutral?0:45));
  const chosen=auto.selectionTeam === auto.homeTeam ? probabilityHome : 1-probabilityHome;
  return {schedule:verified,elo:{probability:chosen,homeRating,awayRating,
    deltaFromBooks:chosen-auto.probability, source:'Experimental score-only Elo',
    disclaimer:'Not calibrated or qualified for wagering; lacks injuries and starting QB adjustments' }};
}

export async function fetchNflReference() {
  const res=await fetch(NFLVERSE_GAMES_URL,{next:{revalidate:REFERENCE_CACHE_SECONDS},signal:AbortSignal.timeout(11000)});
  if(!res.ok) throw new Error(`NFL reference download HTTP ${res.status}`);
  const csv=await res.text();
  const games=parseNflverseGames(csv);
  if(games.length<100) throw new Error('Insufficient NFL reference games');
  return games;
}
