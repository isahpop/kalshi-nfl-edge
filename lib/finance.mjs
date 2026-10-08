/** All monetary amounts are USD. Simulation only — NEVER executes orders. */
export function validPrice(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const p = Number(value);
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}
export function impliedFromAmerican(line) {
  if (line === null || line === undefined || line === '') return null;
  const n = Number(line);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
export function noVigTwoWay(a, b) {
  const pa = impliedFromAmerican(a), pb = impliedFromAmerican(b);
  if (pa === null || pb === null || pa + pb <= 0) return null;
  return [pa / (pa + pb), pb / (pa + pb)];
}
export function calcEdge(probability, price) {
  const p = Number(probability), c = validPrice(price);
  if (c === null || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return { edge: p - c, roi: (p - c) / c, fullKelly: Math.max(0, (p - c) / (1 - c)) };
}
/** Approximate quadratic taker fee for an order, rounded UP to the nearest $0.01.
 * Real fee rates / promotions / series multipliers may vary — check Kalshi schedule.
 */
export function takerFee(contracts, price, feeMultiplier = 1) {
  const p = validPrice(price), n = Number(contracts), m = Number(feeMultiplier);
  if (p === null || !Number.isInteger(n) || n < 0 || !Number.isFinite(m) || m < 0) return null;
  if (n === 0 || m === 0) return 0;
  return Math.ceil(0.07 * m * n * p * (1 - p) * 100 - 1e-9) / 100;
}
/** Exact simulated order economics after estimated taker fee and conservative slippage. */
export function evaluateOrder(probability, askPrice, contracts = 1, options = {}) {
  const p = Number(probability), price = validPrice(askPrice), count = Number(contracts);
  const multiplier = options.feeMultiplier ?? 1;
  const slippage = Number(options.slippageCents ?? 0) / 100;
  if (price === null || !Number.isFinite(p) || p < 0 || p > 1 || !Number.isInteger(count) || count < 1 || !Number.isFinite(slippage) || slippage < 0 || price + slippage >= 1) return null;
  const executionPrice = price + slippage;
  const fees = takerFee(count, executionPrice, multiplier);
  if (fees === null) return null;
  const principal = Number((executionPrice * count).toFixed(4));
  const cost = Number((principal + fees).toFixed(4));
  const expectedProfit = Number((p * count - cost).toFixed(6));
  return { price: executionPrice, principal, fees, cost, contracts: count,
    expectedProfit, netEdge: expectedProfit / count, netRoi: expectedProfit / cost,
    breakeven: cost / count, maxPayout: count, maxProfit: Number((count - cost).toFixed(4)) };
}
/** Quarter Kelly using fee-adjusted breakeven as effective cost; spending is capped.
 * Iteratively accounts for order-level cent rounding. Never exceeds visible quote depth.
 */
export function sizePosition(probability, price, bankroll = 200, options = {}) {
  const balance = Number(bankroll), p = Number(probability), quote = validPrice(price);
  const feeMultiplier = options.feeMultiplier ?? 1;
  const maxTradePct = Math.min(0.05, Math.max(0, Number(options.maxTradePct ?? 0.05)));
  const maxBudget = Math.min(balance * maxTradePct, Number(options.remainingBudget ?? Infinity), balance);
  const depth = options.askSize === null || options.askSize === undefined ? Infinity : Math.max(0, Math.floor(Number(options.askSize)));
  const unavailable = { contracts: 0, stake: 0, fees: 0, kellyPercent: 0, netEdge: null, netRoi: null };
  if (!Number.isFinite(balance) || balance <= 0 || !Number.isFinite(p) || p <= 0 || p > 1 || quote === null || !Number.isFinite(maxBudget) && maxBudget !== Infinity || maxBudget <= 0 || depth < 1) return unavailable;
  const one = evaluateOrder(p, quote, 1, options);
  if (!one || one.netEdge <= 0 || one.breakeven >= 1) return unavailable;
  const fullKelly = Math.max(0, (p - one.breakeven) / (1 - one.breakeven));
  const kellyPercent = Math.min(fullKelly * 0.25, maxTradePct) * 100;
  const allocation = Math.min(maxBudget, balance * kellyPercent / 100);
  if (allocation <= 0) return unavailable;
  const max = Math.min(100000, depth, Math.floor(allocation / quote));
  // Largest integer order affordable under exact rounded fee at the displayed ask.
  let low = 0, high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2), evaluation = evaluateOrder(p, quote, mid, options);
    if (evaluation && evaluation.cost <= allocation + 1e-8 && evaluation.netEdge > 0) low = mid;
    else high = mid - 1;
  }
  if (!low) return { ...unavailable, kellyPercent };
  const result = evaluateOrder(p, quote, low, options);
  return { contracts: low, stake: result.cost, principal: result.principal, fees: result.fees,
    kellyPercent, netEdge: result.netEdge, netRoi: result.netRoi, expectedProfit: result.expectedProfit,
    quoteDepthUsed: Number.isFinite(depth) ? low / depth : null };
}
// Retained for backwards compatibility with existing clients.
export function quarterKelly(probability, price, bankroll = 200, cap = 0.05) {
  const sized = sizePosition(probability, price, bankroll, { maxTradePct: cap });
  const pre = calcEdge(probability, price);
  return { ...sized, edge: pre?.edge ?? null, roi: pre?.roi ?? null };
}
export function paperSummary(trades = [], startBankroll = 200) {
  const starting = Number(startBankroll) || 200;
  const open = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => t.status === 'won' || t.status === 'lost' || t.status === 'void');
  const realized = closed.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const atRisk = open.reduce((sum, t) => sum + Number(t.stake || 0), 0);
  const equity = Math.max(0, starting + realized);
  return { starting, realized: +realized.toFixed(2), atRisk: +atRisk.toFixed(2),
    available: Math.max(0, +(equity - atRisk).toFixed(2)), equity: +equity.toFixed(2),
    openCount: open.length, closedCount: closed.length };
}
export function settlePaperTrade(trade, status) {
  if (!trade || trade.status !== 'open' || !['won','lost','void'].includes(status)) return null;
  const n = Number(trade.contracts), cost = Number(trade.stake);
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(cost) || cost <= 0) return null;
  // A void simulates a refund of the paper stake. Actual settlement rules may differ.
  return { ...trade, status, settledAt: new Date().toISOString(), pnl: status === 'won' ? +(n-cost).toFixed(2) : status === 'lost' ? -cost : 0 };
}
