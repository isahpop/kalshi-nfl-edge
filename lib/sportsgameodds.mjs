/** SportsGameOdds v2 adapter. Pure transforms are separately unit-tested.
 * Only NFL FULL GAME moneylines, not spreads/props/live odds.
 * The independent bookmaker quotes are used; Kalshi is NEVER a model input.
 */
export const SPORTSGAMEODDS_ENDPOINT = 'https://api.sportsgameodds.com/v2/events';
export const HOME_MONEYLINE = 'points-home-game-ml-home';
export const AWAY_MONEYLINE = 'points-away-game-ml-away';
export const FREE_TIER_CACHE_SECONDS = 8 * 60 * 60;
export const FREE_TIER_MAX_EVENTS = 20;

/** Limit returned event objects and payload size, rather than downloading props. */
export function sportsbookRequestUrl(now = Date.now()) {
  const url = new URL(SPORTSGAMEODDS_ENDPOINT);
  // A changing timestamp in this URL would create a new Vercel fetch cache key
  // on every page refresh and needlessly consume the free plan's object quota.
  // Stabilize requests within each eight-hour period.
  const windowStart = Math.floor(now / (FREE_TIER_CACHE_SECONDS * 1000)) * FREE_TIER_CACHE_SECONDS * 1000;
  url.searchParams.set('leagueID', 'NFL');
  url.searchParams.set('oddsAvailable', 'true');
  url.searchParams.set('started', 'false');
  url.searchParams.set('oddID', `${HOME_MONEYLINE},${AWAY_MONEYLINE}`);
  url.searchParams.set('includeAltLines', 'false');
  url.searchParams.set('limit', String(FREE_TIER_MAX_EVENTS));
  // Focus on the upcoming slate, not the full season.
  url.searchParams.set('startsAfter', new Date(windowStart - 3600_000).toISOString());
  url.searchParams.set('startsBefore', new Date(windowStart + 8 * 86400_000).toISOString());
  return url;
}

function validAmericanOdds(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && (n >= 100 || n <= -100) ? n : null;
}

function normalizeSingleEvent(event, now = Date.now()) {
  if (event?.leagueID !== 'NFL' || !event?.eventID) return null;
  const status = event.status || {};
  const kickoff = Date.parse(status.startsAt || '');
  if (!Number.isFinite(kickoff) || kickoff <= now || status.started || status.live || status.cancelled || status.completed) return null;
  const home = event.teams?.home?.names?.long;
  const away = event.teams?.away?.names?.long;
  if (!home || !away || home === away) return null;
  const homeOdd = event.odds?.[HOME_MONEYLINE];
  const awayOdd = event.odds?.[AWAY_MONEYLINE];
  if (!homeOdd || !awayOdd) return null;
  const homeByBook = homeOdd.byBookmaker || {};
  const awayByBook = awayOdd.byBookmaker || {};
  const bookmakers = [];
  for (const [key, homeQuote] of Object.entries(homeByBook)) {
    const awayQuote = awayByBook[key];
    if (!key || !homeQuote || !awayQuote || homeQuote.available !== true || awayQuote.available !== true) continue;
    const homePrice = validAmericanOdds(homeQuote.odds);
    const awayPrice = validAmericanOdds(awayQuote.odds);
    if (homePrice === null || awayPrice === null) continue;
    const homeStamp = Date.parse(homeQuote.lastUpdatedAt || '');
    const awayStamp = Date.parse(awayQuote.lastUpdatedAt || '');
    if (!Number.isFinite(homeStamp) || !Number.isFinite(awayStamp) || Math.abs(homeStamp-awayStamp) > 15*60_000) continue;
    const lastUpdate = new Date(Math.min(homeStamp, awayStamp)).toISOString();
    bookmakers.push({ key, last_update:lastUpdate, markets:[{key:'h2h',last_update:lastUpdate,outcomes:[
      {name:home,price:homePrice},{name:away,price:awayPrice}
    ]}] });
  }
  return {id:event.eventID,home_team:home,away_team:away,commence_time:status.startsAt,bookmakers};
}

export function normalizeSportsGameOdds(data, now = Date.now()) {
  if (!Array.isArray(data)) throw new Error('Unexpected SportsGameOdds event payload');
  const out=[], seen=new Set();
  for (const entry of data) {
    const event=normalizeSingleEvent(entry,now);
    if (event && !seen.has(event.id)) {out.push(event);seen.add(event.id);}
  }
  return out;
}
