import { NextResponse } from 'next/server';
import { getKalshiMarkets, getFeeConfig, getSportsbookOdds } from '../../../lib/feeds.mjs';
import { scoreMarkets, DEFAULT_SETTINGS } from '../../../lib/engine.mjs';
export const runtime='nodejs';
export async function GET() {
  try {
    const [feed, fee] = await Promise.all([getKalshiMarkets(), getFeeConfig()]);
    // Skip provider usage entirely if Kalshi has no open game-winner markets.
    const odds = feed.markets.length ? await getSportsbookOdds() : {configured:!!process.env.SPORTSGAMEODDS_API_KEY, events:[], fetchedAt:null, error:null,provider:'SportsGameOdds',plan:'Amateur (free)',cacheHours:8,limited:false,notice:null};
    // Only fully qualified automated model signals: never infer fair odds from market quotes.
    const rows = scoreMarkets(feed.markets, odds.events, { feeMultiplier:fee.feeMultiplier,
      feeVerified:fee.feeVerified, bankroll:DEFAULT_SETTINGS.startingBankroll, snapshotAt:feed.fetchedAt });
    return NextResponse.json({ rows, markets:rows.length, qualified: rows.filter(r=>r.qualified).length,
      modeled:rows.filter(r=>r.auto).length, truncated:feed.truncated,
      fetchedAt:feed.fetchedAt, fee, sportsbook: {
        configured:odds.configured, fetchedAt:odds.fetchedAt, error:odds.error,
        provider:odds.provider, plan:odds.plan, cacheHours:odds.cacheHours, limited:odds.limited, notice:odds.notice,
        remaining:odds.remaining, eventCount:odds.events.length
      }, settings:DEFAULT_SETTINGS, paperOnly:true },
      { headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=30'} });
  } catch (e) {
    return NextResponse.json({ error:`Scan failed: ${e.message}`, rows:[], paperOnly:true }, {status:502});
  }
}
