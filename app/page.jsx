'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { paperSummary, settlePaperTrade, sizePosition } from '../lib/finance.mjs';
import { scoreMarket, DEFAULT_SETTINGS } from '../lib/engine.mjs';

const money = value => `$${Number(value || 0).toFixed(2)}`;
const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
const priceCents = value => value == null ? '—' : `${(value * 100).toFixed(1).replace(/\.0$/, '')}¢`;
const shortDate = value => { const d = new Date(value || ''); return Number.isFinite(+d) ? d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : 'Unknown'; };
function Icon({ name, size = 18 }) {
  const props = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true };
  const paths = {
    radar:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 19 5M3 12h3M12 18v3"/></>,
    activity:<path d="m2 12 5 0 3-8 4 16 3-8h5"/>,
    wallet:<><path d="M3 7h17v13H3zM3 7V5a2 2 0 0 1 2-2h13M16 13h5v4h-5z"/></>,
    book:<><path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4z"/></>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 2M4 15l2 2a7 7 0 0 0 12-2"/></>,
    arrow:<path d="m5 12 14 0m-6-6 6 6-6 6"/>,
    shield:<><path d="m12 2 9 4v6c0 6-4 9-9 10-5-1-9-4-9-10V6z"/><path d="m8 12 3 3 5-6"/></>,
    download:<path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>
  };
  return <svg {...props}>{paths[name] || paths.search}</svg>;
}
function Stat({ label, value, sub, icon }) { return <div className="stat"><div className="stat-top"><span>{label}</span><Icon name={icon} size={17}/></div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>; }
function csvEscape(v) { return `"${String(v ?? '').replaceAll('"','""')}"`; }
function triggerDownload(name, contents, mime) {
  const url = URL.createObjectURL(new Blob([contents], { type:mime }));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function Dashboard() {
  const [section,setSection] = useState('scanner');
  const [scan,setScan] = useState(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState('all');
  const [manual,setManual] = useState({});
  const [paper,setPaper] = useState([]);
  const [minimumEdge,setMinimumEdge] = useState(2);
  const [ready,setReady] = useState(false);
  const [notice,setNotice] = useState('');
  const [history,setHistory] = useState(null);
  useEffect(()=>{
    try {
      const oldManual = JSON.parse(localStorage.getItem('edge-lab-manual-v1') || '{}');
      const oldPaper = JSON.parse(localStorage.getItem('edge-lab-paper-v1') || '[]');
      const savedManual = JSON.parse(localStorage.getItem('edge-lab-manual-v2') || JSON.stringify(oldManual));
      const savedPaper = JSON.parse(localStorage.getItem('edge-lab-paper-v2') || JSON.stringify(oldPaper));
      if (savedManual && typeof savedManual === 'object' && !Array.isArray(savedManual)) setManual(savedManual);
      if (Array.isArray(savedPaper)) setPaper(savedPaper.filter(t=>t && t.id && t.ticker));
    } catch { setNotice('Browser storage was not available. Paper trades may not persist.'); }
    setReady(true);
  }, []);
  useEffect(()=>{ if (ready) try { localStorage.setItem('edge-lab-manual-v2',JSON.stringify(manual)); } catch {} },[manual,ready]);
  useEffect(()=>{ if (ready) try { localStorage.setItem('edge-lab-paper-v2',JSON.stringify(paper)); } catch {} },[paper,ready]);
  const refresh=useCallback(async()=>{
    setLoading(true); setError('');
    try {
      const res=await fetch('/api/scan',{cache:'no-store'});
      const data=await res.json();
      if (!res.ok || !Array.isArray(data.rows)) throw new Error(data.error||'Scanner is unavailable');
      setScan(data);
      try { const h=await fetch('/data/kalshi-history.json',{cache:'no-store'}); if(h.ok)setHistory(await h.json()); } catch { /* optional archive */ }
    } catch(e) { setError(e.message||'Scanner unavailable'); }
    finally { setLoading(false); }
  }, []);
  useEffect(()=>{refresh();},[refresh]);
  const portfolio=useMemo(()=>paperSummary(paper),[paper]);
  const fee=scan?.fee || { feeMultiplier:1, feeVerified:false };
  const rows=useMemo(()=>(scan?.rows||[]).map(r=>{
    const manualValue=manual[r.ticker];
    return manualValue !== undefined && manualValue !== '' ? scoreMarket(r,[],{ manualFair:manualValue,
      feeMultiplier:fee.feeMultiplier, feeVerified:fee.feeVerified, bankroll:portfolio.equity, snapshotAt:scan?.fetchedAt }) : r;
  }),[scan,manual,fee.feeMultiplier,fee.feeVerified,portfolio.equity]);
  const modeled=rows.filter(m=>m.fair!==null);
  const signals=rows.filter(m=>m.qualified);
  const shown=useMemo(()=>rows.filter(m=>{
    const haystack=`${m.title} ${m.subtitle} ${m.yes_sub_title} ${m.ticker}`.toLowerCase();
    if (!haystack.includes(search.toLowerCase())) return false;
    if (filter === 'modeled' && m.fair === null) return false;
    if (filter === 'research' && !m.reference?.elo) return false;
    if (filter === 'epa' && !m.reference?.epa) return false;
    if (filter === 'calibrated' && !m.reference?.calibrated) return false;
    if (filter === 'signals' && !(m.qualified && m.choices.some(c=>c.qualified && c.netEdge*100>=minimumEdge))) return false;
    return true;
  }).sort((a,b)=>filter==='calibrated'
    ? Math.abs(b.reference?.calibrated?.deltaFromBooks??0)-Math.abs(a.reference?.calibrated?.deltaFromBooks??0)
    : filter==='epa'
    ? Math.abs(b.reference?.epa?.deltaFromBooks??0)-Math.abs(a.reference?.epa?.deltaFromBooks??0)
    : filter==='research'
    ? Math.abs(b.reference?.elo?.deltaFromBooks??0)-Math.abs(a.reference?.elo?.deltaFromBooks??0)
    : Number(b.qualified)-Number(a.qualified) || (b.best?.netEdge??-1)-(a.best?.netEdge??-1)).slice(0,100),[rows,search,filter,minimumEdge]);
  function budgetFor(market) {
    const related=paper.filter(p=>p.status==='open' && (p.eventKey || p.ticker) === (market.eventKey || market.ticker))
      .reduce((n,p)=>n+Number(p.stake||0),0);
    const remainingTotal=Math.max(0,portfolio.equity*DEFAULT_SETTINGS.maxOpenExposurePct/100-portfolio.atRisk);
    const remainingGame=Math.max(0,portfolio.equity*DEFAULT_SETTINGS.maxGameExposurePct/100-related);
    return Math.max(0, Math.min(portfolio.available,remainingTotal,remainingGame));
  }
  function proposal(row, choice) {
    return sizePosition(choice.probability, choice.price,portfolio.equity,{
      feeMultiplier:fee.feeMultiplier, slippageCents:DEFAULT_SETTINGS.slippageCents,
      askSize:choice.depth, remainingBudget:budgetFor(row)
    });
  }
  function addPaper(row, choice) {
    if (!choice || choice.netEdge<=0 || !Number.isFinite(row.fair)) return;
    if (paper.some(t=>t.status==='open'&&t.ticker===row.ticker&&t.side===choice.side)) {
      setNotice('An open paper position for this contract and side already exists.'); return;
    }
    const size=proposal(row,choice);
    if (!size.contracts || size.stake>portfolio.available) { setNotice('No paper capacity remains under the bankroll and exposure limits.'); return; }
    const trade={id:`${Date.now()}-${Math.random().toString(36).slice(2,9)}`, created:new Date().toISOString(),
      ticker:row.ticker, eventKey:row.eventKey, market:row.title || row.ticker, side:choice.side,
      fair:row.fair, price:choice.price, contracts:size.contracts, stake:size.stake, fees:size.fees,
      expectedProfit:size.expectedProfit, source:row.isManual?'manual what-if':'sportsbook consensus',
      quoteWarnings:choice.reasons.join('; '), status:'open', pnl:0};
    setPaper(old=>[trade,...old]);setNotice('Paper position recorded. Quotes are snapshots, not simulated guaranteed fills.');setSection('portfolio');
  }
  function settle(id,outcome) {
    setPaper(old=>old.map(t=>t.id===id ? settlePaperTrade(t,outcome) || t : t));
  }
  function exportCsv() {
    const cols=['created','settledAt','ticker','eventKey','market','side','fair','price','contracts','fees','stake','source','status','pnl','quoteWarnings'];
    triggerDownload('nfl-edge-paper-trades.csv', [cols.join(','),...paper.map(t=>cols.map(c=>csvEscape(t[c])).join(','))].join('\n'),'text/csv;charset=utf-8');
  }
  function exportBackup() {
    triggerDownload('nfl-edge-paper-backup.json',JSON.stringify({version:2,exportedAt:new Date().toISOString(),paper,manual},null,2),'application/json');
  }
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-symbol">E<span>↗</span></div><div className="brand-copy"><b>EDGE<span>LAB</span></b><small>THE NFL MARKET TERMINAL</small></div></div>
      <div className="sidebar-label">WORKSPACE</div><div className="nav-list">
        <button className={`nav-link ${section==='scanner'?'active':''}`} onClick={()=>setSection('scanner')}><Icon name="radar"/> Market scanner <span className="nav-number">{rows.length}</span></button>
        <button className={`nav-link ${section==='portfolio'?'active':''}`} onClick={()=>setSection('portfolio')}><Icon name="wallet"/> Paper portfolio <span className="nav-number">{portfolio.openCount}</span></button>
        <button className={`nav-link ${section==='method'?'active':''}`} onClick={()=>setSection('method')}><Icon name="book"/> Methodology</button>
      </div><div className="sidebar-spacer"/><div className="sidebar-note"><div className="paper-indicator"><span className="dot"/> PAPER ONLY</div><strong>{money(portfolio.equity)}</strong><small>Paper equity including realized P&amp;L</small><div className="side-divider"/><div className="side-tiny">No orders submitted, no account credentials needed.</div></div><p className="sidebar-footer">NFL EDGE LAB / VERSION 2.6</p>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">RESEARCH TERMINAL <span>/</span> <strong>{section==='scanner'?'NFL MARKET SCANNER':section==='portfolio'?'PAPER PORTFOLIO':'METHODOLOGY'}</strong></div><div className="topbar-right"><span className="topbar-pill"><span className="dot"/> PAPER MODE</span><span className="topbar-date">NFL 2026</span></div></header>
      <div className="inner">
        {notice && <div className="notice global-notice" role="status"><Icon name="shield" size={16}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss notice">×</button></div>}
        {section==='scanner' && <>
          <div className="hero"><div><div className="eyebrow"><span className="small-bar"/> NFL RESEARCH / GAME WINNERS</div><h1>Find the <em>edge.</em><br/>Verify the signal.</h1><p>Compare Kalshi ask quotes with independent sportsbook probabilities. Evaluate estimated fees and slippage before assigning a paper stake.</p><div className="hero-chips"><span><span className="dot"/> KALSHI SNAPSHOTS</span><span>NET EXPECTED VALUE</span><span>QUARTER KELLY</span></div></div><div className="hero-art"><div className="grid-sphere"><div className="sphere-inner">25<span>%</span><small>KELLY</small></div></div><div className="hero-caption">RESEARCH OVER HYPE <span>V2.6</span></div></div></div>
          <div className="stats-grid"><Stat label="NFL contracts" value={loading && !scan?'—':rows.length} sub={error?'Feed issue':'Kalshi open game winners'} icon="radar"/><Stat label="Independent models" value={rows.filter(r=>r.auto).length} sub="3+ paired sportsbook lines" icon="activity"/><Stat label="Qualified signals" value={signals.length} sub="After fees and quality gates" icon="shield"/><Stat label="Paper buying power" value={money(portfolio.available)} sub={`${money(portfolio.atRisk)} allocated to open positions`} icon="wallet"/></div>
          {scan?.diagnostics && <div className="diagnostic-panel">
            <div className="diagnostic-title"><strong>Model diagnostics</strong><span>Research estimates are not qualified orders</span></div>
            <div className="diagnostic-stats"><span><b>{scan.diagnostics.positiveNet}</b> with positive estimated net value</span><span><b>{scan.diagnostics.aboveThreshold}</b> above the 2-point threshold</span><span><b>{scan.diagnostics.qualified}</b> fully qualified</span></div>
            {scan.diagnostics.qualified===0 && <p>Zero qualified signals alone does not mean the API failed. These are the most common blockers on modeled contracts:</p>}
            {scan.diagnostics.qualified===0 && <div className="diagnostic-reasons">{scan.diagnostics.blockedReasons.slice(0,3).map(r=><div key={r.reason}><b>{r.count}</b> {r.reason}</div>)}</div>}
            {scan.reference && <div className="reference-summary"><b>Experimental Elo reference</b> · {scan.reference.scheduleVerified} matchups verified against the NFL schedule · {scan.reference.eloModels} Elo comparisons.
              {scan.reference.evaluation?.brier!=null && <span> Historical {scan.reference.evaluation.year} walk-forward Brier score: {scan.reference.evaluation.brier.toFixed(3)} across {scan.reference.evaluation.games} completed games (lower is better).{scan.reference.evaluation.marketBrier!=null && ` Matched ${scan.reference.evaluation.marketGames}-game comparison: Elo ${scan.reference.evaluation.pairedEloBrier.toFixed(3)}, historical moneyline benchmark (timestamp unverified) ${scan.reference.evaluation.marketBrier.toFixed(3)}.`}</span>}
              <div>These ratings use past final scores only; they exclude quarterback/injury information and are not used for qualified signals. Source: nflverse/nfldata.</div>
              {scan.reference.error && <div className="reference-error">NFL schedule unavailable: {scan.reference.error}. Bookmaker comparisons remain available; clock disagreements remain unverified.</div>}
            </div>}
          </div>}
          <section className="section-heading"><div><div className="eyebrow">SCANNER / 01</div><h2>NFL value board</h2><p>Signals require a verified matchup, independent fair odds, accessible ask quotes, and risk limits.</p></div><button className="button button-outline" disabled={loading} onClick={refresh}><Icon name="refresh" size={16}/>{loading?'Scanning…':'Refresh'}</button></section>
          {error && <div className="alert"><b>Scanner issue</b><div>{error}. Last successful snapshot, if any, is shown below.</div></div>}
          {!scan?.sportsbook?.configured && <div className="notice"><Icon name="shield"/><span><b>Automatic modeling is not configured yet.</b> Add a server-side <code>SPORTSGAMEODDS_API_KEY</code> in Vercel to unlock sportsbook-based signals. Manual probabilities are what-if scenarios, not confirmed edges.</span></div>}
          {scan?.sportsbook?.limited && <div className="alert subtle"><b>Odds slate truncated</b><div>The free-plan event cap was reached. Not all upcoming games may be compared.</div></div>}
          {scan?.sportsbook?.notice && <div className="alert subtle"><b>SportsGameOdds free-plan coverage</b><div>Some premium bookmaker prices are omitted under your free plan. Available NFL moneylines can still be used for research. You do not need to upgrade for this scanner. ({scan.sportsbook.notice})</div></div>}
          {scan?.sportsbook?.error && <div className="alert subtle"><b>Sportsbook API issue</b><div>{scan.sportsbook.error}</div></div>}
          {scan?.fee?.feeVerified === false && <div className="alert subtle"><b>Fee schedule could not be verified</b><div>Displayed fees are estimates using a default multiplier. Qualified automatic signals are suspended.</div></div>}
          {scan?.truncated && <div className="alert subtle">Only part of the Kalshi market feed could be loaded. Rankings may be incomplete.</div>}
          <div className="data-line"><span>Kalshi snapshot: {shortDate(scan?.fetchedAt)}</span><span>SportsGameOdds reference: {shortDate(scan?.sportsbook?.fetchedAt)}</span><span>Model: median de-vig, 3+ books</span></div>
          {scan?.epa && <div className="epa-panel"><div className="epa-title"><strong>EPA model lab · experimental</strong><span>Not used for automatic trade signals</span></div>
            <div className="epa-summary"><span><b>{scan.epa.modeled}</b> EPA comparisons</span><span><b>{scan.epa.gamesProcessed}</b> historical games with paired weekly stats</span><span>Latest completed data: <b>{scan.epa.lastCompletedGame || 'unknown'}</b></span></div>
            {scan.epa.backtest?.games>0 && <div className="epa-backtest"><b>{scan.epa.backtest.year} same-game walk-forward test ({scan.epa.backtest.games} games)</b><div className="score-grid">
              <span>EPA proxy <strong>{scan.epa.backtest.epaBrier?.toFixed(3)}</strong></span><span>Elo <strong>{scan.epa.backtest.eloBrier?.toFixed(3)}</strong></span><span>50/50 blend <strong>{scan.epa.backtest.blendBrier?.toFixed(3)}</strong></span><span>Historical bookmaker moneylines <strong>{scan.epa.backtest.bookBrier?.toFixed(3)}</strong></span></div><small>Lower Brier is better. Same games only; benchmark line timing unverified. No parameter optimization or ROI claim.</small></div>}
            {(scan.epa.error||scan.epa.missingSources)&&<div className="reference-error">Weekly EPA availability: {scan.epa.error || scan.epa.missingSources}. Elo and sportsbook pricing continue independently.</div>}
            <small>EPA proxy uses nflverse weekly summed passing/rushing EPA divided by approximate offensive plays. It is not exact play-by-play EPA, a QB injury model, or proof of edge.</small>
          </div>}
          {scan?.calibration && <div className="epa-panel"><div className="epa-title"><strong>Model calibration lab · 2025 fitting holdout</strong><span>Experimental—never authorizes trades</span></div>
            {scan.calibration.available ? <><div className="epa-summary"><span><b>{scan.calibration.trainingGames}</b> training games ({scan.calibration.trainingSeasons?.join(' + ')})</span><span><b>{scan.calibration.testGames}</b> same-game 2025 holdout tests</span><span><b>{scan.calibration.liveModeled}</b> current matchups calibrated</span></div>
              <div className="score-grid calibrated-grid">{[['Sportsbook',scan.calibration.holdout?.sportsbook],['Raw Elo',scan.calibration.holdout?.elo],['Trained Elo',scan.calibration.holdout?.calibratedElo],['Trained Elo + EPA',scan.calibration.holdout?.calibratedEloEpa],['Raw EPA proxy',scan.calibration.holdout?.epaProxy]].map(([label,metric])=><span key={label}>{label}<strong>{metric?.brier?.toFixed(3)??'—'}</strong><small>Brier · log loss {metric?.logLoss?.toFixed(3)??'—'}</small></span>)}</div>
              <small>Lower is better. Coefficients fit only on 2023–24, scored on 2025 games. We have previously inspected 2025 results, so this is not a pristine blind holdout. Moneyline collection timestamps are unverified. No ROI or trading-edge claim.</small>
              {scan.calibration.differenceVsBooks && <div className="history-note">Trained Elo + EPA minus sportsbook Brier: {scan.calibration.differenceVsBooks.meanBrierDifference.toFixed(3)} (approx. 95% interval {scan.calibration.differenceVsBooks.approx95Low.toFixed(3)} to {scan.calibration.differenceVsBooks.approx95High.toFixed(3)}). Intervals assume independent games and are only rough diagnostics.</div>}
            </> : <p>Not enough earlier-season data for a training/holdout comparison. {scan.calibration.error||''}</p>}
          </div>}
          <div className="history-panel"><div className="epa-title"><strong>Kalshi price archive</strong><span>Public top-of-book observations only</span></div>
            <div className="epa-summary"><span><b>{history?.snapshots||0}</b> captured snapshots</span><span><b>{history?.trackedContracts||0}</b> tracked contracts</span><span>Last archived: <b>{history?.lastCapture?shortDate(history.lastCapture):'Not started'}</b></span></div>
            <small>GitHub Actions schedules new observations every two hours after the workflow is enabled. The archive shown here reflects the latest deployed repository version; it may lag behind GitHub. Quotes are not fills, and sportsbook odds are not archived by this collector. <a href="https://github.com/isahpop/kalshi-nfl-edge/actions/workflows/collect-kalshi-prices.yml" target="_blank" rel="noreferrer">Check collector runs</a>.</small>
          </div>
          <div className="scanner-toolbar"><div className="search-wrap"><Icon name="search"/><input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search NFL contracts" placeholder="Find team, game or ticker…" /></div><div className="toggle-group"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>All</button><button className={filter==='modeled'?'selected':''} onClick={()=>setFilter('modeled')}>Modeled</button><button className={filter==='research'?'selected':''} onClick={()=>setFilter('research')}>Elo</button><button className={filter==='epa'?'selected':''} onClick={()=>setFilter('epa')}>EPA</button><button className={filter==='calibrated'?'selected':''} onClick={()=>setFilter('calibrated')}>Trained</button><button className={filter==='signals'?'selected':''} onClick={()=>setFilter('signals')}>Signals</button></div></div>
          {filter==='signals' && <div className="threshold"><label htmlFor="minimum-edge">Minimum net edge</label><input id="minimum-edge" type="range" min="2" max="15" step="1" value={minimumEdge} onChange={e=>setMinimumEdge(Number(e.target.value))}/><span>{minimumEdge}%</span></div>}
          <div className="board-head"><span>GAME / CONTRACT</span><span>MARKET QUOTES</span><span>FAIR PROBABILITY</span><span>FEE-AWARE SIGNAL</span></div>
          {loading && !scan?<div className="empty"><div className="spinner"/><h3>Scanning NFL markets…</h3><p>Checking Kalshi, sportsbook consensus, costs, and quote quality.</p></div>:!shown.length?<div className="empty"><Icon name="radar" size={36}/><h3>No matching contracts</h3><p>{filter==='signals'?'There are no fully qualified opportunities under the current risk rules.':filter==='calibrated'?'No calibrated comparisons yet. Check training coverage and current EPA freshness.':filter==='epa'?'No experimental EPA comparisons are available. Check the weekly stats coverage and schedule feed.':filter==='research'?'No verified experimental Elo comparisons are available. Check the NFL schedule data feed.':'Try a different search or filter. There may be no open NFL markets.'}</p></div>:shown.map(m=>{
            const choice=m.choices.find(c=>c.qualified) || m.best;
            const quote=m.isManual?manual[m.ticker]:(m.auto?(m.auto.probability*100).toFixed(1):'');
            const suggested=choice?proposal(m,choice):null;
            const canPaper=choice && choice.netEdge>0 && suggested?.contracts>0 && (m.isManual || choice.qualified);
            return <article key={m.ticker} className="market-row">
              <div className="market-title"><div className="market-meta"><span className="league-label">NFL · MONEYLINE</span><span>{m.auto?.commenceTime?'Book kickoff':'Kalshi event time'}: {shortDate(m.auto?.commenceTime || m.occurrence_datetime || m.close_time)}</span></div><h3>{m.title || m.yes_sub_title || m.ticker}</h3><div className="ticker">YES = {m.yes_sub_title || '?'} · {m.ticker}</div>{m.reference?.schedule?.verified && <div className="schedule-ok">nflverse schedule confirms {m.reference.schedule.scheduledTimeEt} Eastern kickoff · Kalshi event timestamp is distinct</div>}{m.auto?.kickoffGapMinutes>45 && !m.reference?.schedule?.verified && <div className="source">Kalshi event timestamp: {shortDate(m.occurrence_datetime)} · timing not verified</div>}{history?.contracts?.[m.ticker]?.observations>1 && <div className="history-note">Archived YES ask change: {history.contracts[m.ticker].yesAskChangeCents>0?'+':''}{history.contracts[m.ticker].yesAskChangeCents?.toFixed(1)??'—'}¢ across {history.contracts[m.ticker].observations} observations (not a trade fill)</div>}{m.qualified && <span className="signal-label">QUALIFIED MODEL SIGNAL</span>}</div>
              <div className="quotes"><div><small>YES ASK</small><strong>{priceCents(m.yesPrice)}</strong></div><div><small>NO ASK</small><strong>{priceCents(m.noPrice)}</strong></div></div>
              <div className="fair-cell"><div className="prob-input"><input aria-label={`YES fair probability for ${m.ticker}`} type="number" min="0" max="100" step="0.1" inputMode="decimal" value={quote} onChange={e=>setManual(old=>({...old,[m.ticker]:e.target.value}))} placeholder="Enter %"/><span>%</span></div><div className="source">{m.isManual?'Manual what-if':m.auto?`${m.auto.books} books · median no-vig`:'No independent estimate'}</div>{m.reference?.elo && !m.isManual && <div className="elo-detail">Experimental Elo: <b>{pct(m.reference.elo.probability)}</b> YES · {Math.abs(m.reference.elo.deltaFromBooks*100).toFixed(1)}-point disagreement. <small>Research only—not a trade signal.</small></div>}{m.reference?.epa && !m.isManual && <div className="epa-detail"><b>Experimental EPA proxy: {pct(m.reference.epa.probability)}</b> YES · {Math.abs(m.reference.epa.deltaFromBooks*100).toFixed(1)}-point gap vs books{m.reference.blend&&<span> · Elo/EPA blend: <b>{pct(m.reference.blend.probability)}</b></span>}<small>Research only. No quarterback/injury adjustments. Does not authorize trades.</small></div>}{m.reference?.calibrated && !m.isManual && <div className="epa-detail"><b>Trained Elo + EPA: {pct(m.reference.calibrated.probability)}</b> YES · {Math.abs(m.reference.calibrated.deltaFromBooks*100).toFixed(1)}-point disagreement. <small>Fitted on 2023–24; 2025 holdout diagnostic only. No trade qualification.</small></div>}{m.isManual&&<button className="reset-link" onClick={()=>setManual(old=>{const n={...old};delete n[m.ticker];return n;})}>Restore model</button>}</div>
              <div className="model-cell">{!choice?<div className="awaiting">Not scored<small>Missing fair odds or quote</small></div>:<><div className={`edge-value ${choice.netEdge>0?'positive':'negative'}`}>{choice.netEdge>0?'+':''}{pct(choice.netEdge)} <span>net edge</span></div><div className="model-detail">{choice.side} · {pct(choice.netRoi)} net ROI</div><div className="model-detail">Estimated fee {money(choice.oneContractFee)} for 1 contract · ask depth {choice.depth??'unverified'}</div>{choice.reasons.length>0&&<details className="quality-details"><summary>{choice.reasons.length} check{choice.reasons.length!==1?'s':''} not passed</summary><ul>{choice.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul></details>}{canPaper?<button className="add-button" onClick={()=>addPaper(m,choice)}>{m.isManual?'Paper what-if':'Paper position'} {money(suggested.stake)} <Icon name="arrow" size={14}/></button>:<span className="disabled-small">{choice.netEdge<=0?'No positive fee-adjusted value':'Quality checks, risk cap or depth block a paper position'}</span>}</>}</div>
            </article>;
          })}
          <div className="board-footer">Showing {shown.length} of {rows.length} contracts · Estimated taker fees, 1¢ slippage per contract, no guaranteed fills. Confirm market rules and live quotes before any real decision.</div>
        </>}
        {section==='portfolio' && <><div className="eyebrow">BANKROLL / 02</div><div className="page-title"><h1>Paper portfolio<span>.</span></h1><p>Simulated entries and manually recorded settlements, saved on this device only.</p></div><div className="stats-grid"><Stat label="Paper equity" value={money(portfolio.equity)} sub="Starting $200 plus realized P&L" icon="wallet"/><Stat label="Open exposure" value={money(portfolio.atRisk)} sub={`Limit ${DEFAULT_SETTINGS.maxOpenExposurePct}% of equity`} icon="activity"/><Stat label="Unallocated cash" value={money(portfolio.available)} sub="Available for simulated entries" icon="shield"/><Stat label="Realized P&L" value={money(portfolio.realized)} sub={`${portfolio.closedCount} manually settled positions`} icon="book"/></div><section className="section-heading"><div><div className="eyebrow">PAPER JOURNAL</div><h2>Trade ledger</h2></div><div className="export-buttons"><button className="button button-outline" disabled={!paper.length} onClick={exportCsv}><Icon name="download" size={15}/> CSV</button><button className="button button-outline" disabled={!paper.length} onClick={exportBackup}><Icon name="download" size={15}/> Backup</button></div></section>{paper.length===0?<div className="empty"><Icon name="wallet" size={38}/><h3>No simulated positions yet</h3><p>Try a manual what-if probability or configure an independent odds feed.</p><button className="button button-primary" onClick={()=>setSection('scanner')}>Open scanner <Icon name="arrow" size={15}/></button></div>:<div className="paper-list">{paper.map(trade=><div className="paper-trade" key={trade.id}><div><div className="market-meta"><span className="league-label">{trade.side} · {trade.status.toUpperCase()}</span><span>{shortDate(trade.created)}</span></div><h3>{trade.market}</h3><div className="ticker">{trade.ticker} · {trade.source}</div>{trade.status!=='open'&&<div className={`outcome ${Number(trade.pnl)>0?'positive':Number(trade.pnl)<0?'negative':''}`}>Realized {money(trade.pnl)}</div>}{trade.quoteWarnings&&<p className="paper-warnings">{trade.quoteWarnings}</p>}</div><div className="paper-figures"><div><small>CONTRACTS</small><b>{trade.contracts}</b></div><div><small>ASK</small><b>{priceCents(trade.price)}</b></div><div><small>ALL-IN COST</small><b>{money(trade.stake)}</b></div>{trade.status==='open'&&<div className="settle-actions"><button onClick={()=>settle(trade.id,'won')}>Won</button><button onClick={()=>settle(trade.id,'lost')}>Lost</button><button onClick={()=>settle(trade.id,'void')}>Void</button></div>}</div></div>)}</div>}<div className="notice bottom"><Icon name="shield"/><span><b>Manual settlement only.</b> Won/lost/void are simulation labels, not a verification of Kalshi settlements. Back up your ledger before clearing site data.</span></div></>}
        {section==='method'&&<><div className="eyebrow">METHOD / 03</div><div className="page-title"><h1>Evidence over <em>instinct.</em></h1><p>The calculations and conditions behind every scanner result.</p></div><div className="method-grid"><div className="method-card"><span>01 / INDEPENDENT PROBABILITY</span><h3>Median no-vig moneylines</h3><p>Only NFL game-winner markets. SportsGameOdds free-tier moneylines are cached for 8 hours to preserve its 2,500-object monthly quota. Model calculations require a unique game match and 3+ bookmakers with paired lines. Qualified signals additionally require bookmaker quotes no older than 60 minutes and book disagreement of at most 8 percentage points. A manual override is always marked as a what-if.</p></div><div className="method-card"><span>02 / EXECUTABLE QUOTES</span><h3>Check ask, spread and depth</h3><p>Only YES/NO ask prices, not midpoint or last sale. Automatic signals require visible ask size, a reasonable bid/ask spread and a fresh API snapshot. Kalshi updated_time is metadata, not a quote timestamp. Quote depth does not guarantee a fill.</p></div><div className="method-card"><span>03 / TRUE ECONOMICS</span><h3>Fee-adjusted net edge</h3><p>Net edge = fair probability − (ask + 1¢ slippage + estimated taker fee per contract). Fees use Kalshi's general quadratic formula and official series multiplier when available. Check actual fees and market settlement rules, including ties, at execution.</p></div><div className="method-card"><span>04 / PAPER SIZING</span><h3>Quarter Kelly with limits</h3><p>25% of fee-adjusted full Kelly, maximum 5% of paper equity per order, 10% per game, 25% total open exposure, and never more than displayed ask depth. Sizes always round down to whole contracts.</p></div><div className="method-card"><span>05 / RISK AND FRESHNESS</span><h3>Quality before ranking</h3><p>An automatic signal must clear the default 2-point net edge threshold and all data-quality gates. Missing series fees or bookmaker odds suppress automated flags rather than fabricating values.</p></div><div className="method-card"><span>06 / EXPERIMENTAL ELO</span><h3>Separate team-strength reference</h3><p>We build a basic score-only Elo model from nflverse game results (2022 onward). Ratings update after completed games, regress by a third during the offseason, and include a fixed home-field prior. The Elo gaps tab sorts disagreements with sportsbook consensus for research. Elo does not override the odds feed, pass a quality gate, or create trade signals. QB news, injuries, coaching, rest and many other variables are not included. Historical Brier scoring is a diagnostic, not a guaranteed betting advantage.</p></div><div className="method-card"><span>07 / TRACK RECORD</span><h3>Journal, not proof</h3><p>All trades are simulated and manually settled. New GitHub Actions snapshots archive public Kalshi ask/bid quotes only; they are not fills and do not include sportsbook odds. Trained Elo and Elo+EPA are fitted on 2023–24 and tested on 2025, not used to qualify orders.</p></div></div><div className="notice bottom"><Icon name="shield"/><span>Research tool only. Does not submit Kalshi orders, estimate taxes, guarantee liquidity, or establish a profitable strategy.</span></div></>}
        <footer className="main-footer"><span>EDGE LAB © 2026 · NFL VALUE SCANNER V2.6</span><span>RESEARCH ONLY · NO LIVE EXECUTION</span></footer>
      </div>
    </main>
  </div>;
}
