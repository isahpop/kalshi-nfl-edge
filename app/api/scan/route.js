import { NextResponse } from 'next/server';
import { getKalshiMarkets, getFeeConfig, getSportsbookOdds } from '../../../lib/feeds.mjs';
import { scoreMarkets, summarizeScan, DEFAULT_SETTINGS } from '../../../lib/engine.mjs';
import { fetchNflReference, buildEloReference } from '../../../lib/reference.mjs';
import { fetchWeeklyEpaReference, buildEpaReference } from '../../../lib/epa.mjs';
export const runtime='nodejs';
export async function GET() {
  try {
    // Launch public references concurrently; neither consumes SportsGameOdds quota.
    // Convert provider failures into data so a rejected promise cannot crash the request.
    const schedulePromise=fetchNflReference().then(games=>({games}),e=>({error:e.message||'NFL schedule unavailable'}));
    const weeklyPromise=fetchWeeklyEpaReference().then(source=>({source}),e=>({error:e.message||'EPA weekly reference unavailable'}));
    const [feed, fee] = await Promise.all([getKalshiMarkets(), getFeeConfig()]);
    // Skip provider usage entirely if Kalshi has no open game-winner markets.
    const odds = feed.markets.length ? await getSportsbookOdds() : {configured:!!process.env.SPORTSGAMEODDS_API_KEY, events:[], fetchedAt:null, error:null,provider:'SportsGameOdds',plan:'Amateur (free)',cacheHours:8,limited:false,notice:null};
    // The open NFL schedule is public data; failure must not break the existing scanner.
    let reference=null,referenceError=null,epa=null,epaError=null,epaSeasons=[];
    const [scheduleResult,weeklyResult]=await Promise.all([schedulePromise,weeklyPromise]);
    if(scheduleResult.games){
      try {reference={games:scheduleResult.games,model:buildEloReference(scheduleResult.games)};}
      catch(e){referenceError=e.message||'NFL Elo calculation unavailable';}
    } else referenceError=scheduleResult.error;
    if(weeklyResult.source && reference){
      try{
        epaSeasons=weeklyResult.source.availableSeasons;
        epa={model:buildEpaReference(weeklyResult.source.weeks,reference.games),error:weeklyResult.source.unavailable.join('; ')||null};
      } catch(e){epaError=e.message||'EPA model evaluation failed';}
    } else epaError=weeklyResult.error || (!reference ? 'NFL schedule unavailable for EPA matchup verification' : null);
    // Elo and EPA stay separate from bookmaker fair odds and never qualify a trade.
    const rows = scoreMarkets(feed.markets, odds.events, { feeMultiplier:fee.feeMultiplier,
      feeVerified:fee.feeVerified, bankroll:DEFAULT_SETTINGS.startingBankroll, snapshotAt:feed.fetchedAt,reference:reference?{...reference,epa:epa?.model||null}:null });
    const diagnostics = summarizeScan(rows);
    return NextResponse.json({ rows, markets:rows.length, qualified:diagnostics.qualified,
      modeled:diagnostics.modeled, diagnostics, truncated:feed.truncated,
      reference: { available:!!reference, source:'nflverse/nfldata games.csv',
        scheduleVerified:rows.filter(r=>r.reference?.schedule?.verified).length,
        eloModels:rows.filter(r=>r.reference?.elo).length,
        evaluation:reference?.model?.evaluation||null, error:referenceError,
        description:'Experimental score-only Elo; never used to generate qualified betting signals' },
      epa: { available:!!epa?.model?.epaPresent, source:'nflverse weekly team summary stats',
        model:'Uncalibrated EPA-per-approximate-play proxy; not verified play-level EPA',
        gamesProcessed:epa?.model?.processed||0, lastCompletedGame:epa?.model?.lastDay||null,
        availableSeasons:epaSeasons, missingSources:epa?.error||null,
        modeled:rows.filter(r=>r.reference?.epa).length, backtest:epa?.model?.summary||null,
        error:epaError, referenceOnly:true },
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
