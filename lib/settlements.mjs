/** Public Kalshi settlement facts, kept distinct from timestamped pregame quotes.
 * Never use outcomes to retroactively generate a signal or infer a trade fill.
 */
const API = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES = 'KXNFLGAME';
const TICKER = /^KXNFLGAME-[A-Z0-9-]+$/;
const asDate = v => Number.isFinite(Date.parse(v||'')) ? new Date(v).toISOString() : null;
const dollars = v => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v)>=0 && Number(v)<=1 ? Number(v) : null;

/** Fetch recently settled game-winner markets, bounded to avoid silently partial results.
 * Live API result values are YES/NO (or void); unknown result types remain unverified.
 */
export async function fetchRecentKalshiSettlements({at=new Date(),days=21,fetchImpl=fetch,maxPages=6}={}) {
  const now=new Date(at);
  if (!Number.isFinite(+now) || !Number.isInteger(days) || days<1 || days>60) throw new Error('Invalid settlement lookback');
  const cutoff=Math.floor((+now-days*86400_000)/1000);
  const seen=new Map(); let pages=0,cursor='';
  do {
    const url=new URL(`${API}/markets`);
    url.searchParams.set('series_ticker',SERIES);
    url.searchParams.set('status','settled');
    url.searchParams.set('min_settled_ts',String(cutoff));
    url.searchParams.set('limit','250');
    if(cursor)url.searchParams.set('cursor',cursor);
    const response=await fetchImpl(url.toString(),{signal:AbortSignal.timeout(12000)});
    if(!response?.ok)throw new Error(`Kalshi settled markets HTTP ${response?.status??'unknown'}`);
    const payload=await response.json();
    if(!Array.isArray(payload.markets))throw new Error('Unexpected Kalshi settled markets format');
    for(const item of payload.markets){
      if(item?.status!=='settled'||!TICKER.test(String(item.ticker||'')))continue;
      if(!seen.has(item.ticker))seen.set(item.ticker,item);
    }
    pages++;cursor=typeof payload.cursor==='string'?payload.cursor:'';
    if(cursor && pages>=maxPages)throw new Error('Kalshi settled markets pagination incomplete; refusing partial outcome report');
  }while(cursor);
  return {markets:[...seen.values()],fetchedAt:now.toISOString(),pages};
}

/** Outcomes only count when market status is settled AND result or payout is known.
 * A 50-cent settlement is not mislabeled as a win or loss.
 */
export function normalizeSettlement(market) {
  if(!market||market.status!=='settled'||!TICKER.test(String(market.ticker||'')))return null;
  const rawResult=String(market.result??'').toLowerCase();
  const outcome=['yes','no','void'].includes(rawResult)?rawResult:null;
  const officialPayout=dollars(market.settlement_value_dollars);
  const yesPayout=officialPayout??(outcome==='yes'?1:outcome==='no'?0:null);
  if(yesPayout===null)return null;
  const settledAt=asDate(market.settlement_ts)||null;
  return {ticker:market.ticker,outcome:outcome||'numeric',yesPayout,settledAt,
    source:'Kalshi public settled market'};
}

/** Join only contracts we observed prospectively, not the entire settled universe.
 * The hypothetical first ask is recorded for research; NO position, fills or ROI are inferred.
 */
export function summarizeObservedSettlements(quoteSummary,settledResponse) {
  if(!quoteSummary?.contracts||!Array.isArray(settledResponse?.markets))throw new Error('Settlement summary requires a complete response');
  const tracked=Object.keys(quoteSummary.contracts);
  const mapped=new Map();
  for(const raw of settledResponse.markets){const r=normalizeSettlement(raw);if(r)mapped.set(r.ticker,r);}
  const settled=[];
  for(const ticker of tracked){
    const outcome=mapped.get(ticker),quotes=quoteSummary.contracts[ticker];
    if(!outcome)continue;
    settled.push({...outcome,firstObservedAt:quotes.firstSeen,lastObservedAt:quotes.lastSeen,
      firstObservedYesAsk:dollars(quotes.firstYesAsk),lastObservedYesAsk:dollars(quotes.latestYesAsk),
      observations:quotes.observations});
  }
  settled.sort((a,b)=>(Date.parse(b.settledAt||'')||0)-(Date.parse(a.settledAt||'')||0)||a.ticker.localeCompare(b.ticker));
  return {available:true,fetchedAt:settledResponse.fetchedAt||null,trackedContracts:tracked.length,
    verifiedSettlements:settled.length,unresolvedOrUnverified:tracked.length-settled.length,
    records:settled, note:'Verified public market outcomes linked to archived quotes. First ask is not a fill; no strategy ROI is implied.'};
}
