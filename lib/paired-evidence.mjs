/** Forward-only NFL price evidence. Research, not fills or an execution engine.
 * Sportsbook probabilities are taken from an existing Vercel endpoint: the API
 * key stays exclusively on Vercel. No historical future lines are substituted.
 */
import { consensusForMarket } from './consensus.mjs';
import { evaluateOrder, validPrice } from './finance.mjs';

export const BOOK_CAPTURE_HOURS_UTC = Object.freeze({ 0:[16,20], 1:[22], 4:[22] }); // Sunday, Monday, Thursday
export const BOOK_MAX_AGE_MS = 60 * 60_000;
export const BOOK_CAPTURE_MIN_GAP_MS = 90 * 60_000;
const iso = v => Number.isFinite(Date.parse(v||'')) ? new Date(v).toISOString() : null;
const finite = v => v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v)) ? Number(v) : null;
const truncate = (v,n=190) => String(v??'unavailable').replace(/\s+/g,' ').slice(0,n);

export function shouldCaptureBookReference(at) {
  const d = new Date(at);
  return Number.isFinite(+d) && Boolean(BOOK_CAPTURE_HOURS_UTC[d.getUTCDay()]?.includes(d.getUTCHours()));
}

/** Fetched from a public same-project route. Does NOT pass, store or expose a key.
 * Github only requests this route in the fixed four weekly collection windows.
 */
export async function fetchPublicBookReference({fetchImpl=fetch,url='https://kalshi-nfl-edge.vercel.app/api/odds'}={}) {
  const u=new URL(url);
  if (u.protocol!=='https:' || u.hostname!=='kalshi-nfl-edge.vercel.app' || u.pathname!=='/api/odds' || u.search) throw new Error('Invalid public odds source URL');
  const response=await fetchImpl(u.toString(),{signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}});
  if(!response?.ok)throw new Error(`Public sportsbook reference HTTP ${response?.status||'unavailable'}`);
  const body=await response.json();
  if(body?.configured!==true || !Array.isArray(body.events) || body.events.length===0 || body.error) throw new Error(truncate(body?.error||'Sportsbook source unconfigured or no games'));
  if(body.events.length>20)throw new Error('Unusually large sportsbook response; refused for safety');
  return {events:body.events,latestBookAt:iso(body.fetchedAt),source:'Vercel /api/odds (cached SportsGameOdds)',limited:body.limited===true};
}

function screenSide({ask,bid,depth,probability,feeMultiplier,feeVerified}) {
  if(validPrice(ask)===null)return null;
  const economics=evaluateOrder(probability,ask,1,{feeMultiplier,slippageCents:1});
  if(!economics)return null;
  const spread=finite(bid)===null?null:ask-bid;
  const clean=feeVerified && Number.isFinite(depth) && depth>=1 && spread!==null && spread>=0 && spread<=.12;
  return {ask,netEdge:Number(economics.netEdge.toFixed(6)),oneContractCost:economics.cost,
    fee:economics.fees,spread,depth,passed:clean && economics.netEdge>=.02};
}

/** Called only with pregame quotes taken at the current collection time. */
export function makePairedBookBatch(quoteBatch,rawMarkets,bookResult) {
  const at=iso(quoteBatch?.capturedAt),now=Date.parse(at||'');
  if(!at||!Array.isArray(rawMarkets)||!Array.isArray(quoteBatch.markets))throw new Error('Pairing requires timestamped Kalshi prices');
  if(!Array.isArray(bookResult?.events)||!bookResult.events.length)throw new Error('No sportsbook games for pairing');
  const byTicker=new Map(rawMarkets.map(m=>[m.ticker,m]));
  const pairs=[];
  for(const q of quoteBatch.markets){
    const m=byTicker.get(q.ticker);
    if(!m)continue;
    // Strict 60-minute *oldest* bookmaker quote limit, not API request time.
    const c=consensusForMarket(m,bookResult.events,{now,maxAgeMs:BOOK_MAX_AGE_MS});
    if(!c)continue;
    const oldest=Date.parse(c.oldestBookAt),kickoff=Date.parse(c.commenceTime);
    if(!Number.isFinite(oldest)||oldest>now+60_000||now-oldest>BOOK_MAX_AGE_MS||!Number.isFinite(kickoff)||kickoff<=now)continue;
    const yes=screenSide({ask:q.yesAsk,bid:q.yesBid,depth:q.yesSize,probability:c.probability,
      feeMultiplier:quoteBatch.feeMultiplier,feeVerified:quoteBatch.feeVerified});
    const no=screenSide({ask:q.noAsk,bid:q.noBid,depth:q.noSize,probability:1-c.probability,
      feeMultiplier:quoteBatch.feeMultiplier,feeVerified:quoteBatch.feeVerified});
    const candidates=[['YES',yes],['NO',no]].filter(([,x])=>x?.passed).sort((a,b)=>b[1].netEdge-a[1].netEdge);
    pairs.push({ticker:q.ticker,eventTicker:q.eventTicker,kickoffAt:c.commenceTime,
      selectedTeam:c.selectionTeam,homeTeam:c.homeTeam,awayTeam:c.awayTeam,
      bookmakerEventId:c.eventId,books:c.books,range:Number(c.range.toFixed(6)),
      oldestBookAt:c.oldestBookAt,bookAgeMinutes:Math.round((now-oldest)/60000),
      kalshiTimestampGapMinutes:c.kickoffGapMinutes,
      yesProbability:Number(c.probability.toFixed(6)),yes,no,
      screenSide:candidates[0]?.[0]??null,
      screenNetEdge:candidates[0]?.[1]?.netEdge??null,
      screenCost:candidates[0]?.[1]?.oneContractCost??null});
  }
  return {capturedAt:at,source:'Kalshi captured alongside existing cached Vercel sportsbook reference',
    bookLatestAt:bookResult.latestBookAt??null,bookSource:bookResult.source??'Vercel /api/odds',
    bookLimited:bookResult.limited===true,quotesObserved:quoteBatch.markets.length,
    matched:pairs.length,status:'success',pairs};
}

export function pairedFailure(at,error) {
  const capturedAt=iso(at);
  if(!capturedAt)throw new Error('Invalid attempt timestamp');
  return {capturedAt,status:'unavailable',error:truncate(error?.message||error),pairs:[],matched:0};
}

/** Bounded dashboard summary. Each historical screen is determined prospectively.
 * We can show one-contract hypothetical settlement arithmetic once an actual
 * Kalshi settlement is verified, but never suggest an order was placed/filled.
 */
export function summarizePairedBookBatches(batches,{asOf=new Date(),days=35,settlements=[]}={}) {
  const time=iso(asOf),cutoff=Date.parse(time)-days*86400_000;
  if(!time||!Array.isArray(batches))throw new Error('Invalid paired evidence summary');
  const sorted=batches.filter(b=>iso(b?.capturedAt)&&Date.parse(b.capturedAt)>=cutoff&&Date.parse(b.capturedAt)<=Date.parse(time))
    .sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
  const observations=[],seen=new Set(),allCandidates=[];
  for(const batch of sorted){
    if(seen.has(batch.capturedAt))continue;seen.add(batch.capturedAt);
    for(const p of batch.pairs||[]){
      if(!p?.ticker||!Number.isFinite(p.yesProbability))continue;
      observations.push({at:batch.capturedAt,...p});
      if(p.screenSide && p.screenNetEdge>=.02)allCandidates.push({at:batch.capturedAt,...p});
    }
  }
  const settlementMap=new Map(settlements.filter(x=>x&&typeof x.ticker==='string'&&Number.isFinite(x.yesPayout))
    .map(x=>[x.ticker,x]));
  // One fixed first qualifying observation per actual NFL game, never cherry-pick hindsight.
  const firstPerGame=new Map();
  for(const c of allCandidates){
    const key=c.eventTicker||c.ticker;
    if(!firstPerGame.has(key))firstPerGame.set(key,c);
  }
  let paperSettled=0,paperPending=0,paperProfit=0,paperSpent=0;
  for(const c of firstPerGame.values()){
    const outcome=settlementMap.get(c.ticker);
    if(!outcome||!outcome.settledAt||Date.parse(outcome.settledAt)<=Date.parse(c.at)){paperPending++;continue;}
    const payout=c.screenSide==='YES'?outcome.yesPayout:1-outcome.yesPayout;
    paperProfit+=payout-c.screenCost;paperSpent+=c.screenCost;paperSettled++;
  }
  const recentCandidates=allCandidates.slice(-6).reverse().map(c=>({ticker:c.ticker,at:c.at,
    side:c.screenSide,netEdge:c.screenNetEdge,books:c.books,ageMinutes:c.bookAgeMinutes,
    price:c[c.screenSide?.toLowerCase()]?.ask??null}));
  const last=sorted.at(-1);
  return {generatedAt:time,windowDays:days,attempts:sorted.length,successfulCaptures:sorted.filter(x=>x.status==='success').length,
    failedCaptures:sorted.filter(x=>x.status==='unavailable').length,lastAttempt: last?.capturedAt||null,
    lastError:last?.status==='unavailable'?last.error:null,
    matchedObservations:observations.length,screenCandidates:allCandidates.length,
    firstCandidateGames:firstPerGame.size,
    paperOneContract:{settled:paperSettled,pending:paperPending,hypotheticalNetDollars:Number(paperProfit.toFixed(2)),
      hypotheticalSpentDollars:Number(paperSpent.toFixed(2)),
      note:'Fixed first screen-positive quote per game; theoretical 1-contract cost including fees and 1c slippage. Assumes a fill at ask, ignores market impact; NOT actual or reliably executable profit.'},
    latestCandidates:recentCandidates,
    limitation:'Pregame quotes only if bookmaker timestamps ≤60 minutes old. Kalshi kickoff timing not independently verified by the collector; price comparison is research, not a trade recommendation.'};
}
