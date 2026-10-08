/** GitHub Action or local node job: archive public Kalshi price snapshots.
 * Does not require credentials, make live orders, or consume SportsGameOdds quota.
 */
import { readdir, readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getKalshiMarkets, getFeeConfig } from '../lib/feeds.mjs';
import { createQuoteBatch, summarizeQuoteBatches } from '../lib/price-history.mjs';
import { fetchRecentKalshiSettlements, summarizeObservedSettlements } from '../lib/settlements.mjs';

export async function collectQuotes({root=process.cwd(),now=new Date(),feed=getKalshiMarkets,feeFeed=getFeeConfig,settledFeed=fetchRecentKalshiSettlements}={}){
  const time=new Date(now).toISOString();
  const [quotes,fees]=await Promise.all([feed(),feeFeed()]);
  // Refuse to commit a partially paged or empty feed as if it were a full snapshot.
  if(quotes.truncated||!quotes.markets?.length)throw new Error('Kalshi snapshot missing or truncated: nothing saved');
  const batch=createQuoteBatch(quotes.markets,{capturedAt:time,feeMultiplier:fees.feeMultiplier,
    feeVerified:fees.feeVerified,truncated:quotes.truncated});
  if(!batch.markets.length)throw new Error('No valid open Kalshi contracts; nothing saved');
  const dir=resolve(root,'data','snapshots');await mkdir(dir,{recursive:true});
  const file=join(dir,`${time.slice(0,10)}.jsonl`);
  await appendFile(file,JSON.stringify(batch)+'\n','utf8');
  const lookbackDate=Date.parse(time)-14*86400_000;
  const names=(await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)&&Date.parse(n.slice(0,10))>=lookbackDate);
  const all=[];
  for(const name of names){
    const content=await readFile(join(dir,name),'utf8');
    for(const line of content.split('\n').filter(Boolean)){
      try{all.push(JSON.parse(line));}catch{ /* ignore a corrupted historical line; keep collecting */ }
    }
  }
  const summary=summarizeQuoteBatches(all,{asOf:time,days:14});
  // Outcome collection uses only Kalshi's public endpoint; a failure must not
  // block quote archival or erase previously verified settlements.
  const previousFile=resolve(root,'public','data','kalshi-history.json');
  let previousSettlements=null;
  try { previousSettlements=JSON.parse(await readFile(previousFile,'utf8')).settlements??null; } catch {}
  try {
    const settled=await settledFeed({at:now});
    summary.settlements=summarizeObservedSettlements(summary,settled);
  } catch(e) {
    summary.settlements=previousSettlements?{...previousSettlements,stale:true,error:String(e.message||e)}
      :{available:false,stale:true,error:String(e.message||e),verifiedSettlements:null,records:[]};
  }
  const out=resolve(root,'public','data');await mkdir(out,{recursive:true});
  await writeFile(join(out,'kalshi-history.json'),JSON.stringify(summary,null,2)+'\n','utf8');
  return {file,marketCount:batch.markets.length,snapshots:summary.snapshots,trackedContracts:summary.trackedContracts};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href){
  collectQuotes().then(x=>console.log('Kalshi public price capture:',x)).catch(err=>{console.error(err.message);process.exitCode=1});
}
