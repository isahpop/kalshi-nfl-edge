import { validPrice, calcEdge, evaluateOrder, sizePosition } from './finance.mjs';
import { consensusForMarket } from './consensus.mjs';
import { isKalshiOpen } from './teams.mjs';
import { eloForMatch } from './reference.mjs';
import { epaForMatch } from './epa.mjs';
export const DEFAULT_SETTINGS = Object.freeze({ startingBankroll: 200, minEdgePct: 2, maxSpreadPct: 12, maxSnapshotAgeMinutes: 3, minAskSize: 1, slippageCents: 1, maxOpenExposurePct: 25, maxGameExposurePct: 10 });
const numOrNull = value => value === undefined || value === null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const parseTime = value => { const parsed = Date.parse(value||''); return Number.isFinite(parsed) ? parsed : null; };
export function scoreMarket(market, oddsEvents = [], options = {}) {
  const now = Number(options.now ?? Date.now());
  const settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const auto = consensusForMarket(market, oddsEvents, { now });
  const reference = auto && options.reference?.games && options.reference?.model
    ? eloForMatch(auto, options.reference.games, options.reference.model) : null;
  const epa = auto && options.reference?.epa && options.reference?.games
    ? epaForMatch(auto,options.reference.games,options.reference.epa) : null;
  const rawManual = options.manualFair;
  const isManual = rawManual !== null && rawManual !== undefined && rawManual !== '';
  const manual = isManual ? Number(rawManual) : null;
  const fair = isManual && Number.isFinite(manual) && manual >= 0 && manual <= 100 ? manual/100 : !isManual ? auto?.probability ?? null : null;
  const feeMultiplier = options.feeMultiplier ?? 1;
  // updated_time tracks market METADATA, not last quote. Use actual API snapshot time.
  const snapshotAt = parseTime(options.snapshotAt);
  const ageMinutes = snapshotAt !== null ? Math.max(0,(now - snapshotAt)/60000) : null;
  const snapshotStale = ageMinutes === null || ageMinutes > settings.maxSnapshotAgeMinutes;
  const yesAsk = validPrice(market.yes_ask_dollars), noAsk = validPrice(market.no_ask_dollars);
  const yesBid = numOrNull(market.yes_bid_dollars), noBid = numOrNull(market.no_bid_dollars);
  const spreadYes = yesAsk !== null && yesBid !== null ? yesAsk-yesBid : null;
  const spreadNo = noAsk !== null && noBid !== null ? noAsk-noBid : null;
  const choices = [];
  if (fair !== null) for (const [side, probability, ask, spread, rawDepth] of [['YES',fair,yesAsk,spreadYes,market.yes_ask_size_fp],['NO',1-fair,noAsk,spreadNo,market.no_ask_size_fp ?? market.yes_bid_size_fp]]) {
    if (ask === null) continue;
    const depth = numOrNull(rawDepth);
    const raw = calcEdge(probability, ask);
    const net = evaluateOrder(probability, ask, 1, { feeMultiplier, slippageCents: settings.slippageCents });
    if (!net || !raw) continue;
    const reasons = [];
    if (!isKalshiOpen(market)) reasons.push('Market not open');
    if (snapshotStale) reasons.push('API snapshot too old or unverified');
    if (depth === null || depth < settings.minAskSize) reasons.push('Ask depth unverified or empty');
    if (spread === null || spread < -0.0001 || spread > settings.maxSpreadPct/100) reasons.push('Spread too wide or unknown');
    if (net.netEdge < settings.minEdgePct/100) reasons.push('Net edge below threshold');
    if (auto && (!Number.isFinite(Date.parse(auto.oldestBookAt || '')) || now-Date.parse(auto.oldestBookAt)>60*60000)) reasons.push('Sportsbook odds older than 60 minutes: reference only');
    if (auto && auto.kickoffGapMinutes > 45 && !reference?.schedule?.verified)
      reasons.push(`Provider kickoff times disagree by ${auto.kickoffGapMinutes} minutes: schedule not independently verified`);
    if (isManual) reasons.push('Manual what-if: not an automatic signal');
    if (options.feeVerified === false) reasons.push('Series fee multiplier unverified');
    const size = sizePosition(probability, ask, Number(options.bankroll ?? settings.startingBankroll), {
      feeMultiplier, slippageCents: settings.slippageCents, askSize: depth,
      remainingBudget: options.remainingBudget ?? Infinity
    });
    // A negative edge produces a zero Kelly allocation by design. Never tell
    // the user they "cannot afford" a contract when the real issue is value.
    if (size.contracts < 1 && net.netEdge >= settings.minEdgePct/100)
      reasons.push('Kelly allocation too small for one contract at this price');
    choices.push({ side, probability, price: ask, spread, depth, rawEdge: raw.edge, rawRoi: raw.roi,
      netEdge: net.netEdge, netRoi: net.netRoi, breakeven: net.breakeven,
      // Order-level rounding means the hypothetical 1-contract fee is not the
      // same as the fee for an actual multi-contract paper order.
      oneContractFee: net.fees, size, reasons,
      qualified: reasons.length === 0 });
  }
  choices.sort((a,b)=>b.netEdge-a.netEdge);
  const best = choices[0] ?? null;
  return { ...market, yesPrice: yesAsk, noPrice: noAsk, auto, fair, isManual,
    reference:reference ? { schedule:reference.schedule, elo:reference.elo,
      epa, blend:epa&&reference.elo? { probability:(epa.probability+reference.elo.probability)/2,
        deltaFromBooks:(epa.probability+reference.elo.probability)/2-auto.probability,
        source:'50/50 experimental Elo/EPA proxy (not calibrated)' }:null } : null,
    feeMultiplier, snapshotAgeMinutes: ageMinutes, best, choices,
    qualified: !!choices.find(c=>c.qualified), eventKey: market.event_ticker || auto?.eventKey || market.ticker };
}
export function scoreMarkets(markets = [], events = [], options = {}) {
  return markets.map(m => scoreMarket(m, events, options));
}

/** A count of independently modeled contracts blocked by each quality gate.
 * One contract counts at most once for each reason; missing-model markets are
 * excluded because they have no price comparison to diagnose.
 */
export function summarizeScan(rows = [], minEdgePct = DEFAULT_SETTINGS.minEdgePct) {
  const modeled = rows.filter(row => row.auto && !row.isManual);
  const minEdge = Number(minEdgePct) / 100;
  const thresholdPositive = modeled.filter(row => row.choices?.some(c => c.netEdge >= minEdge));
  const positive = modeled.filter(row => row.choices?.some(c => c.netEdge > 0));
  const qualified = modeled.filter(row => row.qualified);
  const blockerCounts = new Map();
  for (const row of modeled) {
    if (row.qualified) continue;
    // Diagnose the economically strongest candidate on each contract, not a
    // random alternate side with unrelated restrictions.
    const reasons = new Set(row.best?.reasons || []);
    for (const reason of reasons) blockerCounts.set(reason, (blockerCounts.get(reason) || 0) + 1);
  }
  return {
    modeled: modeled.length,
    positiveNet: positive.length,
    aboveThreshold: thresholdPositive.length,
    qualified: qualified.length,
    blockedReasons: [...blockerCounts.entries()].map(([reason, count]) => ({ reason, count }))
      .sort((a,b) => b.count-a.count || a.reason.localeCompare(b.reason)),
  };
}
