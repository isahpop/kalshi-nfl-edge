/** Public Kalshi quote collector with optional, quota-sparing sportsbook reference.
 * All observations live in the EXISTING two GitHub Actions staged archive paths.
 * No credentials, live orders, account history or SportsGameOdds key in GitHub.
 */
import { readdir, readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getKalshiMarkets, getFeeConfig } from '../lib/feeds.mjs';
import { createQuoteBatch, summarizeQuoteBatches } from '../lib/price-history.mjs';
import { fetchRecentKalshiSettlements, summarizeObservedSettlements } from '../lib/settlements.mjs';
import { shouldCaptureBookReference, fetchPublicBookReference, makePairedBookBatch,
  pairedFailure, summarizePairedBookBatches } from '../lib/paired-evidence.mjs';

export async function collectQuotes({root=process.cwd(),now=new Date(),feed=getKalshiMarkets,
  feeFeed=getFeeConfig,settledFeed=fetchRecentKalshiSettlements,bookFeed=fetchPublicBookReference,
  forceBook=false}={}){
  const time=new Date(now).toISOString();
  const [quotes,fees]=await Promise.all([feed(),feeFeed()]);
  // Never record a partial or empty Kalshi feed as a complete market snapshot.
  if(quotes.truncated||!quotes.markets?.length)throw new Error('Kalshi snapshot missing or truncated: nothing saved');
  const batch=createQuoteBatch(quotes.markets,{capturedAt:time,feeMultiplier:fees.feeMultiplier,
    feeVerified:fees.feeVerified,truncated:quotes.truncated});
  if(!batch.markets.length)throw new Error('No valid open Kalshi contracts; nothing saved');
  const dir=resolve(root,'data','snapshots');await mkdir(dir,{recursive:true});
  // Preserve up to 35 days of paired audit records, even though the detailed
  // Kalshi quote-movement summary displays only the last 14 days.
  const cutoff=Date.parse(time)-35*86400_000;
  const names=(await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)&&Date.parse(n.slice(0,10))>=cutoff);
  const all=[];
  for(const name of names){
    const content=await readFile(join(dir,name),'utf8');
    for(const line of content.split('\n').filter(Boolean)){
      try{all.push(JSON.parse(line));}catch{/* Ignore corrupted historical line without losing others. */}
    }
  }
  const currentHour=time.slice(0,13);
  const alreadyTried=all.some(b=>b.bookPair?.capturedAt?.startsWith(currentHour));
  let pairAttempt=null;
  // Four fixed windows per week. Manually dispatched GitHub Action can opt in
  // without modifying the preexisting hidden workflow. One attempt per UTC hour.
  if((forceBook||shouldCaptureBookReference(time))&&!alreadyTried){
    try { pairAttempt=makePairedBookBatch(batch,quotes.markets,await bookFeed()); }
    catch(e) { pairAttempt=pairedFailure(time,e); }
    batch.bookPair=pairAttempt; // EXISTING staged raw JSONL path; no extra git add.
  }
  const file=join(dir,`${time.slice(0,10)}.jsonl`);
  await appendFile(file,JSON.stringify(batch)+'\n','utf8');
  all.push(batch);
  const summary=summarizeQuoteBatches(all,{asOf:time,days:14});
  const previousFile=resolve(root,'public','data','kalshi-history.json');
  let previousSettlements=null;
  try{previousSettlements=JSON.parse(await readFile(previousFile,'utf8')).settlements??null;}catch{}
  // Kalshi settlement API failure must never block quote collection or clear
  // previously recorded verified outcomes.
  try{
    const settled=await settledFeed({at:now});
    summary.settlements=summarizeObservedSettlements(summary,settled);
    // Retain outcomes verified on previous runs even after their quotes leave
    // the 14-day display window. Never relabel them as new observations.
    if(Array.isArray(previousSettlements?.records)){
      const verified=new Map(previousSettlements.records.filter(r=>r?.ticker&&Number.isFinite(r.yesPayout)).map(r=>[r.ticker,r]));
      for(const record of summary.settlements.records)verified.set(record.ticker,record);
      summary.settlements.records=[...verified.values()].sort((a,b)=>(Date.parse(b.settledAt||'')||0)-(Date.parse(a.settledAt||'')||0));
      summary.settlements.verifiedSettlements=verified.size;
    }
  }catch(e){
    summary.settlements=previousSettlements?{...previousSettlements,stale:true,error:String(e.message||e)}
      :{available:false,stale:true,error:String(e.message||e),verifiedSettlements:null,records:[]};
  }
  summary.pairedEvidence=summarizePairedBookBatches(all.filter(b=>b.bookPair).map(b=>b.bookPair),{
    asOf:time,settlements:summary.settlements?.records||[]});
  summary.coverage='Kalshi quotes captured every ~2 hours; selected NFL windows include timestamped sportsbook no-vig consensus from Vercel when fresh. Best asks are not fills.';
  const out=resolve(root,'public','data');await mkdir(out,{recursive:true});
  await writeFile(join(out,'kalshi-history.json'),JSON.stringify(summary,null,2)+'\n','utf8');
  return {file,marketCount:batch.markets.length,snapshots:summary.snapshots,
    trackedContracts:summary.trackedContracts,pairedAttempt:pairAttempt?.status||'not scheduled',
    pairedMatches:pairAttempt?.matched||0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href){
  collectQuotes({forceBook:process.env.FORCE_BOOK_REFERENCE==='true'||process.env.GITHUB_EVENT_NAME==='workflow_dispatch'})
    .then(x=>console.log('Kalshi public price capture:',x))
    .catch(err=>{console.error(err.message);process.exitCode=1});
}
