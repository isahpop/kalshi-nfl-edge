/** Timestamped Kalshi top-of-book snapshots; historical quotes, not guaranteed fills.
 * Does not record any private account data or consume SportsGameOdds allowance.
 */
const finite=(v,min,max)=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
const iso=s=>Number.isFinite(Date.parse(s||''))?new Date(s).toISOString():null;
export function createQuoteBatch(markets,opts={}){
  const capturedAt=iso(opts.capturedAt??new Date().toISOString());
  if(!capturedAt||!Array.isArray(markets))throw new Error('Invalid quote batch');
  const seen=new Set();const clean=[];
  for(const m of markets){
    if(!/^KXNFLGAME-[A-Z0-9-]+$/.test(String(m.ticker||''))||seen.has(m.ticker))continue;
    if(!['active','open'].includes(m.status))continue;
    const yesAsk=finite(m.yes_ask_dollars,0,1),noAsk=finite(m.no_ask_dollars,0,1);
    if(yesAsk===null&&noAsk===null)continue;
    seen.add(m.ticker);
    clean.push({ticker:m.ticker,eventTicker:m.event_ticker||null,gameTime:m.occurrence_datetime||null,
      yesAsk,noAsk,yesBid:finite(m.yes_bid_dollars,0,1),noBid:finite(m.no_bid_dollars,0,1),
      yesSize:finite(m.yes_ask_size_fp,0,1e12),noSize:finite(m.no_ask_size_fp,0,1e12),
      volume24h:finite(m.volume_24h_fp,0,1e12)});
  }
  clean.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  return {capturedAt,source:'Kalshi public KXNFLGAME top-of-book API',feeMultiplier:finite(opts.feeMultiplier,0,10),
    feeVerified:opts.feeVerified===true, truncated:opts.truncated===true,markets:clean};
}
export function summarizeQuoteBatches(batches,opts={}){
  const asOf=iso(opts.asOf||new Date().toISOString());
  if(!asOf)throw new Error('Invalid history as-of date');
  const cutoff=Date.parse(asOf)-(opts.days??14)*86400000;
  const sorted=[...batches].filter(x=>x&&iso(x.capturedAt)&&Date.parse(x.capturedAt)>=cutoff&&Date.parse(x.capturedAt)<=Date.parse(asOf))
    .sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
  const contract=new Map(),timestamps=new Set();let quoteCount=0;
  for(const batch of sorted){
    if(timestamps.has(batch.capturedAt))continue;timestamps.add(batch.capturedAt);
    for(const m of batch.markets||[]){
      if(!m.ticker||!Number.isFinite(m.yesAsk)&&!Number.isFinite(m.noAsk))continue;
      quoteCount++;
      if(!contract.has(m.ticker))contract.set(m.ticker,[]);
      contract.get(m.ticker).push({at:batch.capturedAt,yesAsk:m.yesAsk,noAsk:m.noAsk,yesSize:m.yesSize,noSize:m.noSize});
    }
  }
  const contracts={};
  for(const [ticker,points] of contract){
    const validYes=points.map(p=>p.yesAsk).filter(Number.isFinite), first=points[0],last=points.at(-1);
    contracts[ticker]={observations:points.length,firstSeen:first.at,lastSeen:last.at,
      firstYesAsk:first.yesAsk,latestYesAsk:last.yesAsk,latestNoAsk:last.noAsk,
      yesAskChangeCents:Number.isFinite(first.yesAsk)&&Number.isFinite(last.yesAsk)?Math.round((last.yesAsk-first.yesAsk)*1000)/10:null,
      yesAskLow:validYes.length?Math.min(...validYes):null,yesAskHigh:validYes.length?Math.max(...validYes):null,
      recent:points.slice(-12).map(p=>({at:p.at,yesAsk:p.yesAsk}))};
  }
  return {generatedAt:asOf,firstCapture:[...timestamps][0]||null,lastCapture:[...timestamps].at(-1)||null,
    snapshots:timestamps.size,observations:quoteCount,trackedContracts:contract.size,windowDays:opts.days??14,
    coverage:'Kalshi public quotes only. Best asks are not executions. No historical sportsbook consensus is archived yet.',contracts};
}
