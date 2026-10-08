'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { calcEdge, quarterKelly, validPrice } from '../lib/finance.mjs';
import { consensusForMarket } from '../lib/consensus.mjs';

const money = n => `$${Number(n || 0).toFixed(2)}`;
const pct = n => `${(n * 100).toFixed(1)}%`;
const priceCents = n => n == null ? '—' : `${Math.round(n * 100)}¢`;
const dateLabel = iso => {
  if (!iso) return 'Time not listed';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time not listed';
};
function Icon({ name, size=18 }) {
  const common={ width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true };
  if (name === 'radar') return <svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 19 5M3 12h3M12 18v3"/></svg>;
  if (name === 'activity') return <svg {...common}><path d="m2 12 5 0 3-8 4 16 3-8h5"/></svg>;
  if (name === 'wallet') return <svg {...common}><path d="M3 7h17v13H3zM3 7V5a2 2 0 0 1 2-2h13M16 13h5v4h-5z"/></svg>;
  if (name === 'book') return <svg {...common}><path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4z"/></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 2M4 15l2 2a7 7 0 0 0 12-2"/></svg>;
  if (name === 'arrow') return <svg {...common}><path d="m5 12 14 0m-6-6 6 6-6 6"/></svg>;
  if (name === 'shield') return <svg {...common}><path d="m12 2 9 4v6c0 6-4 9-9 10-5-1-9-4-9-10V6z"/><path d="m8 12 3 3 5-6"/></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/></svg>;
  return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>;
}
function Stat({ label, value, sub, icon }) { return <div className="stat"><div className="stat-top"><span>{label}</span><Icon name={icon} size={17}/></div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>; }
function csvValue(v) { return `"${String(v ?? '').replaceAll('"','""')}"`; }
export default function Dashboard() {
  const [section, setSection] = useState('scanner');
  const [markets, setMarkets] = useState([]);
  const [odds, setOdds] = useState([]);
  const [oddsConfigured, setOddsConfigured] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [oddsError, setOddsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [manual, setManual] = useState({});
  const [paper, setPaper] = useState([]);
  const [minimumEdge, setMinimumEdge] = useState(2);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const savedProb = JSON.parse(localStorage.getItem('edge-lab-manual-v1') || '{}');
      const savedPaper = JSON.parse(localStorage.getItem('edge-lab-paper-v1') || '[]');
      if (savedProb && typeof savedProb === 'object' && !Array.isArray(savedProb)) setManual(savedProb);
      if (Array.isArray(savedPaper)) setPaper(savedPaper);
    } catch { /* storage can be unavailable */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem('edge-lab-manual-v1', JSON.stringify(manual)); } catch {} } }, [manual, ready]);
  useEffect(() => { if (ready) { try { localStorage.setItem('edge-lab-paper-v1', JSON.stringify(paper)); } catch {} } }, [paper, ready]);
  const refresh = useCallback(async () => {
    setLoading(true); setMarketError(''); setOddsError('');
    const responses = await Promise.allSettled([fetch('/api/markets', { cache:'no-store' }), fetch('/api/odds', { cache:'no-store' })]);
    try {
      if (responses[0].status !== 'fulfilled') throw new Error('Kalshi feed could not be reached');
      const r = responses[0].value, data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to load Kalshi markets');
      setMarkets(data.markets || []); setFetchedAt(data.fetchedAt);
    } catch(e) { setMarketError(e.message); setMarkets([]); }
    try {
      if (responses[1].status !== 'fulfilled') throw new Error('Sportsbook odds feed could not be reached');
      const r = responses[1].value, data = await r.json();
      setOddsConfigured(!!data.configured);
      if (!r.ok) throw new Error(data.error || 'Unable to load sportsbook odds');
      setOdds(data.events || []);
    } catch(e) { setOddsError(e.message); setOdds([]); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const rows = useMemo(() => markets.map(m => {
    const auto = odds.length ? consensusForMarket(m, odds) : null;
    const value = manual[m.ticker];
    const isManual = value !== undefined && value !== '';
    const fair = isManual && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=100 ? Number(value)/100 : (!isManual && auto ? auto.probability : null);
    const yesPrice = validPrice(m.yes_ask_dollars);
    const noPrice = validPrice(m.no_ask_dollars);
    const yes = fair !== null && yesPrice !== null ? calcEdge(fair, yesPrice) : null;
    const no = fair !== null && noPrice !== null ? calcEdge(1-fair, noPrice) : null;
    const choices = [yes && { side:'YES', price:yesPrice, probability:fair, ...yes }, no && { side:'NO', price:noPrice, probability:1-fair, ...no }].filter(Boolean).sort((a,b) => b.edge - a.edge);
    const best = choices.length ? choices[0] : null;
    return { ...m, auto, isManual, fair, best, yesPrice, noPrice };
  }), [markets, odds, manual]);
  const positives = rows.filter(m => m.best?.edge > 0);
  const modeled = rows.filter(m => m.fair !== null);
  const reserved = paper.reduce((sum,p) => sum + (Number(p.stake)||0),0);
  const available = Math.max(0,200-reserved);
  const shown = useMemo(() => rows.filter(m => {
    const s = `${m.title} ${m.subtitle} ${m.yes_sub_title} ${m.ticker}`.toLowerCase();
    if (!s.includes(search.toLowerCase())) return false;
    if (filter === 'modeled' && m.fair === null) return false;
    if (filter === 'signals' && !(m.best && m.best.edge*100 >= minimumEdge)) return false;
    return true;
  }).sort((a,b) => (b.best?.edge ?? -2)-(a.best?.edge ?? -2)).slice(0,60), [rows, search, filter, minimumEdge]);
  const addPaper = (row) => {
    if (!row.best || row.best.edge <= 0 || row.fair === null) return;
    const s = quarterKelly(row.best.probability, row.best.price, available);
    if (!s.contracts) return;
    setPaper(old => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, created: new Date().toISOString(), ticker: row.ticker, market: row.title || row.ticker, side: row.best.side, fair: row.fair, price: row.best.price, contracts: s.contracts, stake: s.stake, source: row.isManual ? 'manual' : 'consensus', status: 'open' }, ...old]);
    setSection('portfolio');
  };
  const exportCsv=()=> {
    const header=['created','ticker','market','side','fair','price','contracts','stake','source','status'];
    const data=[header.join(','),...paper.map(trade=>header.map(k=>csvValue(trade[k])).join(','))].join('\n');
    const blob=new Blob([data],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download='nfl-edge-paper-trades.csv';a.click();URL.revokeObjectURL(url);
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">E<span>↗</span></div><div className="brand-copy"><b>EDGE<span>LAB</span></b><small>THE NFL MARKET TERMINAL</small></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <div className="nav-list">
        <button onClick={()=>setSection('scanner')} className={`nav-link ${section==='scanner'?'active':''}`}><Icon name="radar"/> Market scanner <span className="nav-number">{markets.length}</span></button>
        <button onClick={()=>setSection('portfolio')} className={`nav-link ${section==='portfolio'?'active':''}`}><Icon name="wallet"/> Paper portfolio <span className="nav-number">{paper.length}</span></button>
        <button onClick={()=>setSection('method')} className={`nav-link ${section==='method'?'active':''}`}><Icon name="book"/> Methodology</button>
      </div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-note"><div className="paper-indicator"><span className="dot"/> PAPER TRADING ONLY</div><strong>$200.00</strong><small>Starting virtual bankroll</small><div className="side-divider"/><div className="side-tiny">Read-only research terminal. No live orders, no automatic trades.</div></div>
      <p className="sidebar-footer">NFL EDGE LAB / VERSION 0.1</p>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">RESEARCH TERMINAL <span>/</span> <strong>{section==='scanner'?'MARKETS':section==='portfolio'?'PAPER PORTFOLIO':'METHODOLOGY'}</strong></div><div className="topbar-right"><span className="topbar-pill"><span className="dot"/> NFL 2026</span><span className="topbar-date">{new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div></header>
      <div className="inner">
        {section === 'scanner' && <>
          <div className="hero"><div><div className="eyebrow"><span className="small-bar"/> NFL MARKETS · WEEKLY SCAN</div><h1>Find the <em>edge.</em><br/>Manage the risk.</h1><p>Explore Kalshi NFL game-winner markets, estimate fair value, and size simulated positions with disciplined bankroll rules.</p><div className="hero-chips"><span><span className="dot"/> KALSHI MARKET DATA</span><span>1/4 KELLY SIZING</span><span>NO REAL TRADES</span></div></div><div className="hero-art" aria-hidden="true"><div className="grid-sphere"><div className="sphere-inner">25<span>%</span><small>KELLY</small></div></div><div className="hero-caption">DISCIPLINE OVER HYPE<span>01 / 03</span></div></div></div>
          <div className="stats-grid"><Stat label="Market contracts" value={loading ? '—' : markets.length} sub={marketError ? 'Feed unavailable' : 'Open NFL game contracts'} icon="radar"/><Stat label="Priced by a model" value={modeled.length} sub="Manual or bookmaker consensus" icon="activity"/><Stat label="Positive pre-fee EV" value={positives.length} sub="Research signals, not trade advice" icon="shield"/><Stat label="Paper buying power" value={money(available)} sub={`${money(reserved)} reserved in paper trades`} icon="wallet"/></div>
          <section className="section-heading"><div><div className="eyebrow">SCANNER / 01</div><h2>Live market board</h2><p>Model probabilities are required before a contract can be scored.</p></div><button className="button button-outline" onClick={refresh} disabled={loading}><Icon name="refresh" size={15}/>{loading?'Loading…':'Refresh data'}</button></section>
          {marketError && <div className="alert"><b>Kalshi connection issue</b><div>{marketError}</div></div>}
          {oddsError && <div className="alert subtle"><b>Sportsbook comparison unavailable</b><div>{oddsError}. Manual fair probabilities still work.</div></div>}
          {!oddsConfigured && <div className="notice"><Icon name="shield" size={18}/><span><b>Automatic fair-value modeling not configured.</b> Enter your own fair probability on a contract to calculate edge, or add an <code>ODDS_API_KEY</code> on Vercel for conservative sportsbook consensus matching.</span></div>}
          <div className="scanner-toolbar"><div className="search-wrap"><Icon name="search"/><input aria-label="Search markets" placeholder="Search team, market, or ticker..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="toggle-group"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>All</button><button className={filter==='modeled'?'selected':''} onClick={()=>setFilter('modeled')}>Modeled</button><button className={filter==='signals'?'selected':''} onClick={()=>setFilter('signals')}>Signals</button></div></div>
          {filter==='signals' && <div className="threshold"><label htmlFor="minedge">Minimum pre-fee edge</label><input id="minedge" type="range" min="0" max="15" step="1" value={minimumEdge} onChange={e=>setMinimumEdge(Number(e.target.value))}/><span>{minimumEdge}%</span></div>}
          <div className="board-head"><span>GAME / CONTRACT</span><span>KALSHI ASKS</span><span>FAIR PROBABILITY</span><span>MODEL RESULT</span></div>
          {loading && !markets.length ? <div className="empty"><div className="spinner"/><h3>Loading the NFL market board…</h3><p>Requesting currently open contracts from Kalshi.</p></div> : !shown.length ? <div className="empty"><Icon name="radar" size={36}/><h3>No matching markets</h3><p>{marketError?'The market feed is unavailable right now.':filter==='signals'?'No contracts currently meet your model and edge threshold.':'Try another filter or search. There may be no open NFL games listed right now.'}</p></div> : shown.map(m=>{
            const k=m.best && m.best.edge>0?quarterKelly(m.best.probability,m.best.price,available):null;
            const fairText=m.isManual?manual[m.ticker]:(m.auto?Number((m.auto.probability*100).toFixed(1)): '');
            return <article className="market-row" key={m.ticker}>
              <div className="market-title"><div className="market-meta"><span className="league-label">NFL · MONEYLINE</span><span>{dateLabel(m.expected_expiration_time || m.close_time)}</span></div><h3>{m.title || m.yes_sub_title || m.ticker}</h3><div className="ticker">{m.yes_sub_title ? `YES = ${m.yes_sub_title} · `:''}{m.ticker}</div></div>
              <div className="quotes"><div><small>YES ASK</small><strong>{priceCents(m.yesPrice)}</strong></div><div><small>NO ASK</small><strong>{priceCents(m.noPrice)}</strong></div></div>
              <div className="fair-cell"><div className="prob-input"><input aria-label={`Fair YES probability for ${m.ticker}`} type="number" inputMode="decimal" min="0" max="100" step="0.1" value={fairText} onChange={e=>setManual(x=>({...x,[m.ticker]:e.target.value}))} placeholder="Enter %"/><span>%</span></div><div className="source">{m.isManual?'Your assumption':m.auto?`No-vig · ${m.auto.books} books`:'Awaiting probability'}</div>{m.isManual && <button className="reset-link" onClick={()=>setManual(x=>{const copy={...x};delete copy[m.ticker];return copy;})}>Reset to auto</button>}</div>
              <div className="model-cell">{m.fair===null ? <div className="awaiting">Not scored<small>Add a fair probability</small></div> : m.best ? <><div className={`edge-value ${m.best.edge>0?'positive':'negative'}`}>{m.best.edge>0?'+':''}{pct(m.best.edge)} <span>edge</span></div><div className="model-detail">{m.best.side} · {m.best.roi>0?'+':''}{pct(m.best.roi)} ROI pre-fee</div>{k?.contracts>0 ? <button className="add-button" onClick={()=>addPaper(m)}>Paper trade {money(k.stake)} <Icon name="arrow" size={14}/></button> : <span className="disabled-small">{m.best.edge>0?'Too small for 1 contract':'No positive pre-fee edge'}</span>}</> : <div className="awaiting">No quote<small>Ask price unavailable</small></div>}</div>
            </article>;
          })}
          <div className="board-footer">{shown.length} of {rows.length} open contracts shown · {fetchedAt?`Kalshi snapshot: ${dateLabel(fetchedAt)}`:'No Kalshi snapshot yet'} · Prices and opportunities can change.</div>
        </>}
        {section === 'portfolio' && <><div className="eyebrow">BANKROLL / 02</div><div className="page-title"><h1>Paper portfolio<span>.</span></h1><p>A virtual trade log saved in this browser. Outcomes are not settled automatically.</p></div><div className="stats-grid"><Stat label="Starting bankroll" value="$200.00" sub="Fixed V1 paper allocation" icon="wallet"/><Stat label="Reserved stake" value={money(reserved)} sub="Paper cash at risk" icon="activity"/><Stat label="Unallocated" value={money(available)} sub="Available for new paper positions" icon="shield"/><Stat label="Open paper positions" value={paper.length} sub="No realized P&L tracked" icon="book"/></div><section className="section-heading"><div><div className="eyebrow">ACTIVITY</div><h2>Research trade journal</h2></div><button disabled={!paper.length} className="button button-outline" onClick={exportCsv}><Icon name="download" size={15}/> Export CSV</button></section>{!paper.length?<div className="empty"><Icon name="wallet" size={38}/><h3>No paper positions yet</h3><p>Go to the market scanner, enter a probability, and choose a positive-edge contract.</p><button className="button button-primary" onClick={()=>setSection('scanner')}>Open scanner <Icon name="arrow" size={15}/></button></div>:<div className="paper-list">{paper.map(trade=><div key={trade.id} className="paper-trade"><div><div className="market-meta"><span className="league-label">{trade.side} · PAPER</span><span>{dateLabel(trade.created)}</span></div><h3>{trade.market}</h3><div className="ticker">{trade.ticker}</div></div><div className="paper-figures"><div><small>CONTRACTS</small><b>{trade.contracts}</b></div><div><small>ENTRY</small><b>{priceCents(trade.price)}</b></div><div><small>STAKE</small><b>{money(trade.stake)}</b></div><button className="remove" title="Remove paper position" onClick={()=>setPaper(x=>x.filter(p=>p.id!==trade.id))}>Remove</button></div></div>)}</div>}<div className="notice bottom"><Icon name="shield" size={18}/><span>Paper positions remain open until you remove them. Closing a row here is not a sale and does not calculate profit/loss.</span></div></>}
        {section === 'method' && <><div className="eyebrow">METHOD / 03</div><div className="page-title"><h1>Evidence over <em>instinct.</em></h1><p>How the V1 model estimates value and limits exposure.</p></div><div className="method-grid"><div className="method-card"><span>01 / PRICING</span><h3>Use the executable ask</h3><p>Kalshi YES/NO ask quotes are used as the estimated purchase cost, not a last-trade price or a midpoint. Missing quotes cannot be scored.</p></div><div className="method-card"><span>02 / PROBABILITY</span><h3>Find fair probability</h3><p>Enter a personal forecast or, with a configured odds API, use a two-way bookmaker-consensus probability with each book's overround removed. Unmatched games are never assigned a guess.</p></div><div className="method-card"><span>03 / EXPECTED VALUE</span><h3>Price against probability</h3><p>Pre-fee edge = estimated event probability − purchase price. Expected ROI = edge ÷ purchase price. This is model-dependent, not a guaranteed advantage.</p></div><div className="method-card"><span>04 / RISK</span><h3>Quarter Kelly, hard capped</h3><p>Full Kelly = (p − cost) ÷ (1 − cost), floored at zero. We use 25% of that result and never allocate more than 5% of the unallocated $200 paper bankroll to a single trade.</p></div><div className="method-card"><span>05 / DATA QUALITY</span><h3>Don't confuse quotes with wins</h3><p>Quotes may be stale, spreads may be wide, and models may be wrong. V1 does not incorporate Kalshi-specific fees or fill depth. Always verify settlement terms.</p></div><div className="method-card"><span>06 / NEXT VERSION</span><h3>Expand market coverage</h3><p>After moneyline validation: historical snapshots, fee-aware EV, more NFL market types, independent forecasting, database-backed paper results and backtests.</p></div></div><div className="notice bottom"><Icon name="shield" size={18}/><span>This application is a research prototype, not financial advice and not a promise of profitable outcomes. It never places orders or accesses an account balance.</span></div></>}
        <footer className="main-footer"><span>EDGE LAB © 2026 · INDEPENDENT RESEARCH TOOL</span><span>NO GUARANTEED RETURNS · NO LIVE EXECUTION</span></footer>
      </div>
    </main>
  </div>;
}
