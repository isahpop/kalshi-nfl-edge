import { noVigTwoWay } from './finance.mjs';
import { matchEventForMarket } from './teams.mjs';
export function consensusForMarket(market, events = []) {
  const match = matchEventForMarket(market, events);
  if (!match) return null;
  const { event, selection } = match;
  const prices = [];
  for (const book of event.bookmakers || []) {
    const h2h = book.markets?.find(m => m.key === 'h2h');
    const home = h2h?.outcomes?.find(o => o.name === event.home_team);
    const away = h2h?.outcomes?.find(o => o.name === event.away_team);
    if (!home || !away) continue;
    const clean = noVigTwoWay(home.price, away.price);
    if (!clean) continue;
    const lastUpdate = Date.parse(h2h.last_update || book.last_update || '');
    if (Number.isFinite(lastUpdate) && Date.now() - lastUpdate > 60*60*1000*12) continue;
    prices.push(selection === event.home_team ? clean[0] : clean[1]);
  }
  if (prices.length < 2) return null; // Require multiple books for a consensus.
  return { probability: prices.reduce((a,b) => a+b, 0) / prices.length, books: prices.length, source: 'Sportsbook consensus (no-vig)' };
}
