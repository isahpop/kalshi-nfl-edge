import { sportsbookRequestUrl, normalizeSportsGameOdds, FREE_TIER_CACHE_SECONDS } from './sportsgameodds.mjs';
const API = 'https://external-api.kalshi.com/trade-api/v2';
export const SERIES = 'KXNFLGAME';
const timeout = 12000;
async function getJson(url, cacheSeconds) {
  const res = await fetch(url, { next: { revalidate: cacheSeconds }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Data provider returned HTTP ${res.status}`);
  return { data: await res.json(), response: res };
}
/** Page through all open game-winner contracts, bounded to prevent runaway API calls. */
export async function getKalshiMarkets() {
  const markets = [], seen = new Set();
  let cursor = '', truncated = false, pages = 0;
  do {
    const url = new URL(`${API}/markets`);
    url.searchParams.set('series_ticker', SERIES);
    url.searchParams.set('status','open'); url.searchParams.set('limit','250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const { data } = await getJson(url, 60);
    if (!Array.isArray(data.markets)) throw new Error('Unexpected Kalshi market response');
    for (const m of data.markets) if (m.ticker && !seen.has(m.ticker)) {
      seen.add(m.ticker); markets.push(m);
    }
    cursor = data.cursor || ''; pages++;
    if (pages >= 6 && cursor) { truncated = true; break; }
  } while (cursor);
  return { markets, fetchedAt: new Date().toISOString(), pages, truncated };
}
/** Prefer official series multiplier; if unavailable, mark the fee as unverified. */
export async function getFeeConfig() {
  try {
    const { data } = await getJson(`${API}/series/${SERIES}`, 3600);
    const multiplier = Number(data.series?.fee_multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) throw new Error('Missing fee multiplier');
    return { feeMultiplier: multiplier, feeVerified:true, feeNotice:'General quadratic taker rate; confirm fee schedule for exceptions' };
  } catch {
    return { feeMultiplier:1, feeVerified:false, feeNotice:'Fee multiplier unverified; calculations are estimates and automatic signals are suppressed' };
  }
}
/** Free SportsGameOdds Amateur tier: cap at 20 NFL events and cache 8 hours.
 * ~20 objects x 3 lookups/day x 30 days = 1,800 events (under 2,500 cap),
 * subject to provider rules, actual usage and cache invalidation / misses.
 * Browser refresh does NOT bypass the eight-hour provider cache.
 */
export async function getSportsbookOdds() {
  const apiKey = process.env.SPORTSGAMEODDS_API_KEY;
  const meta = {provider:'SportsGameOdds',plan:'Amateur (free)',cacheHours:8};
  if (!apiKey) return { ...meta, configured:false,events:[],fetchedAt:null,remaining:null,error:null,limited:false,notice:null };
  try {
    const url = sportsbookRequestUrl();
    const res = await fetch(url,{headers:{'x-api-key':apiKey},next:{revalidate:FREE_TIER_CACHE_SECONDS},signal:AbortSignal.timeout(timeout)});
    if (!res.ok) {
      if (res.status === 429) throw new Error('SportsGameOdds usage limit reached (HTTP 429). Wait for reset; check your account usage.');
      if (res.status === 401 || res.status === 403) throw new Error('SportsGameOdds key is invalid, inactive or lacks access (HTTP '+res.status+').');
      throw new Error('SportsGameOdds returned HTTP '+res.status);
    }
    const payload=await res.json();
    if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('Unexpected SportsGameOdds response');
    const events=normalizeSportsGameOdds(payload.data);
    // This is the latest bookmaker update, not a falsely fresh timestamp at read time.
    const times=events.flatMap(e=>e.bookmakers.map(b=>Date.parse(b.last_update))).filter(Number.isFinite);
    const latestBookAt=times.length?new Date(Math.max(...times)).toISOString():null;
    return { ...meta,configured:true,events,fetchedAt:latestBookAt,remaining:null,error:null,
      limited:Boolean(payload.nextCursor),notice: typeof payload.notice==='string'?payload.notice:null };
  } catch(e) {
    return { ...meta,configured:true,events:[],fetchedAt:null,remaining:null,
      error:e.message,limited:false,notice:null };
  }
}
