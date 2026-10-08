import test from 'node:test';
import assert from 'node:assert/strict';
import { getKalshiMarkets, getFeeConfig, getSportsbookOdds } from './feeds.mjs';

test('market pagination preserves all unique tickers and advertises freshness', async()=>{
  const prior=global.fetch, urls=[];
  global.fetch=async url=>{
    urls.push(String(url));
    const cursor=new URL(url).searchParams.get('cursor');
    return {ok:true,json:async()=>cursor?{markets:[{ticker:'B'}, {ticker:'C'}],cursor:''}:{markets:[{ticker:'A'},{ticker:'B'}],cursor:'more'}};
  };
  try {
    const feed=await getKalshiMarkets();assert.deepEqual(feed.markets.map(x=>x.ticker),['A','B','C']);
    assert.equal(feed.pages,2);assert.equal(feed.truncated,false);assert.ok(feed.fetchedAt);
    assert.ok(urls.every(u=>u.includes('series_ticker=KXNFLGAME')));
  } finally {global.fetch=prior;}
});
test('fees use the multiplier delivered by series endpoint and are suppressed when it fails', async()=>{
  const prior=global.fetch;
  try {
    global.fetch=async()=>({ok:true,json:async()=>({series:{fee_multiplier:0.5}})});
    assert.deepEqual((await getFeeConfig()).feeMultiplier,0.5);
    global.fetch=async()=>({ok:false,status:503});
    const failed=await getFeeConfig();assert.equal(failed.feeVerified,false);assert.equal(failed.feeMultiplier,1);
  } finally {global.fetch=prior;}
});
test('missing sportsbook key makes no paid requests and sends no fabricated odds',async()=>{
  const prior=process.env.SPORTSGAMEODDS_API_KEY;const previousFetch=global.fetch;
  delete process.env.SPORTSGAMEODDS_API_KEY;
  global.fetch=()=>{throw Error('should not request');};
  try {const odds=await getSportsbookOdds();assert.equal(odds.configured,false);assert.deepEqual(odds.events,[]);}
  finally {if(prior===undefined)delete process.env.SPORTSGAMEODDS_API_KEY;else process.env.SPORTSGAMEODDS_API_KEY=prior;global.fetch=previousFetch;}
});

test('SportsGameOdds key is passed only in secure HTTP header and its secret never appears in the URL or response',async()=>{
  const old=process.env.SPORTSGAMEODDS_API_KEY,prior=global.fetch,now=Date.now();
  process.env.SPORTSGAMEODDS_API_KEY='test-secret-not-real';
  const kickoff=new Date(now+48*3600000).toISOString();
  let calls=0;
  global.fetch=async(url,opts)=>{
    calls++;
    assert.equal(opts.headers['x-api-key'],'test-secret-not-real');
    assert.equal(new URL(url).searchParams.has('apiKey'),false);
    assert.equal(opts.next.revalidate,8*3600);
    assert.ok(String(url).includes('leagueID=NFL'));
    return {ok:true,json:async()=>({success:true,data:[{
      eventID:'sample',leagueID:'NFL',status:{startsAt:kickoff,started:false},
      teams:{home:{names:{long:'Dallas Cowboys'}},away:{names:{long:'Philadelphia Eagles'}}},
      odds:{'points-home-game-ml-home':{byBookmaker:{}},'points-away-game-ml-away':{byBookmaker:{}}}
    }]})};
  };
  try {
    const result=await getSportsbookOdds();
    assert.equal(calls,1);assert.equal(result.configured,true);assert.equal(result.provider,'SportsGameOdds');
    assert.equal(result.events.length,1);assert.equal(result.events[0].bookmakers.length,0);
    assert.equal(JSON.stringify(result).includes('test-secret-not-real'),false);
  } finally {if(old===undefined)delete process.env.SPORTSGAMEODDS_API_KEY;else process.env.SPORTSGAMEODDS_API_KEY=old;global.fetch=prior;}
});

test('Provider rate-limit failures are explicit, without fabricated market odds',async()=>{
  const old=process.env.SPORTSGAMEODDS_API_KEY,prior=global.fetch;
  process.env.SPORTSGAMEODDS_API_KEY='test-not-real';
  global.fetch=async()=>({ok:false,status:429});
  try {const result=await getSportsbookOdds();assert.equal(result.configured,true);assert.deepEqual(result.events,[]);assert.match(result.error,/429/);}
  finally {if(old===undefined)delete process.env.SPORTSGAMEODDS_API_KEY;else process.env.SPORTSGAMEODDS_API_KEY=old;global.fetch=prior;}
});
