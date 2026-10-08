import { noVigTwoWay } from './finance.mjs';
import { matchEventForMarket } from './teams.mjs';
const median = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length % 2 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2;
};
/** Independent sportsbook-derived moneyline estimate, not derived from Kalshi prices.
 * Rejects old lines, disagreement, and ambiguous matchups.
 */
export function consensusForMarket(market, events = [], options = {}) {
  const now = Number(options.now ?? Date.now()), maxAgeMs = Number(options.maxAgeMs ?? 9*60*60000);
  const minBooks = Number(options.minBooks ?? 3);
  const match = matchEventForMarket(market, events, now);
  if (!match) return null;
  const { event, selection, kickoffGapMinutes } = match;
  const prices = [], publishers = new Set(), timestamps = [];
  for (const book of event.bookmakers || []) {
    const key = book.key || book.title;
    if (!key || publishers.has(key)) continue;
    const h2h = book.markets?.find(m => m.key === 'h2h');
    if (!h2h || h2h.outcomes?.length !== 2) continue;
    const home = h2h.outcomes.find(o => o.name === event.home_team);
    const away = h2h.outcomes.find(o => o.name === event.away_team);
    if (!home || !away) continue;
    const updated = Date.parse(h2h.last_update || book.last_update || '');
    if (!Number.isFinite(updated) || updated > now + 60000 || now - updated > maxAgeMs) continue;
    const clean = noVigTwoWay(home.price, away.price);
    if (!clean) continue;
    const probability = selection === event.home_team ? clean[0] : clean[1];
    publishers.add(key); prices.push(probability); timestamps.push(updated);
  }
  if (prices.length < minBooks) return null;
  const range = Math.max(...prices) - Math.min(...prices);
  if (range > Number(options.maxRange ?? 0.08)) return null;
  return { probability: median(prices), books: prices.length, range, kickoffGapMinutes,
    oldestBookAt: new Date(Math.min(...timestamps)).toISOString(),
    source:'Median no-vig sportsbook moneyline', eventId: event.id || '', commenceTime: event.commence_time,
    eventKey: `${event.home_team}|${event.away_team}|${event.commence_time}` };
}
