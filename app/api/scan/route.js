import { NextResponse } from 'next/server';
import { getKalshiMarkets, getFeeConfig, getSportsbookOdds } from '../../../lib/feeds.mjs';
import { scoreMarkets, summarizeScan, DEFAULT_SETTINGS } from '../../../lib/engine.mjs';
import { fetchNflReference, buildEloReference } from '../../../lib/reference.mjs';
export const runtime='nodejs';
export async function GET() {
  try {
    const [feed, fee] = await Promise.all([getKalshiMarkets(), getFeeConfig()]);
    // Skip provider usage entirely if Kalshi has no open game-winner markets.
    const odds = feed.markets.length ? await getSportsbookOdds() : {configured:!!process.env.SPORTSGAMEODDS_API_KEY, events:[], fetchedAt:null, error:null,provider:'SportsGameOdds',plan:'Amateur (free)',cacheHours:8,limited:false,notice:null};
    // The open NFL schedule is public data; failure must not break the existing scanner.
    let reference=null, referenceError=null;
    try {
      const games=await fetchNflReference();
      reference={games,model:buildEloReference(games)};
    } catch (e) { referenceError=e.message || 'NFL schedule unavailable'; }
    // Elo stays separate from bookmaker fair odds and never qualifies a trade.
    const rows = scoreMarkets(feed.markets, odds.events, { feeMultiplier:fee.feeMultiplier,
      feeVerified:fee.feeVerified, bankroll:DEFAULT_SETTINGS.startingBankroll, snapshotAt:feed.fetchedAt,reference });
    const diagnostics = summarizeScan(rows);
    return NextResponse.json({ rows, markets:rows.length, qualified:diagnostics.qualified,
      modeled:diagnostics.modeled, diagnostics, truncated:feed.truncated,
      reference: { available:!!reference, source:'nflverse/nfldata games.csv',
        scheduleVerified:rows.filter(r=>r.reference?.schedule?.verified).length,
        eloModels:rows.filter(r=>r.reference?.elo).length,
        evaluation:reference?.model?.evaluation||null, error:referenceError,
        description:'Experimental score-only Elo; never used to generate qualified betting signals' },
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
