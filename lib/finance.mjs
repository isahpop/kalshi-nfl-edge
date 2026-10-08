/** ALL outputs are before fees and slippage; this tool does not submit orders. */
export function validPrice(value) {
  const p = Number(value);
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}
export function calcEdge(probability, price) {
  const p = Number(probability);
  const c = validPrice(price);
  if (c === null || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return {
    edge: p - c,
    roi: (p - c) / c,
    fullKelly: Math.max(0, (p - c) / (1 - c)),
  };
}
export function quarterKelly(probability, price, bankroll = 200, cap = 0.05) {
  const stats = calcEdge(probability, price);
  const balance = Math.max(0, Number(bankroll) || 0);
  if (!stats || stats.edge <= 0 || balance <= 0) {
    return { contracts: 0, stake: 0, kellyPercent: 0, edge: stats?.edge ?? null, roi: stats?.roi ?? null };
  }
  const fraction = Math.min(Math.max(0, stats.fullKelly * 0.25), cap);
  const contracts = Math.floor((balance * fraction + 1e-9) / Number(price));
  return {
    contracts,
    stake: Number((contracts * Number(price)).toFixed(2)),
    kellyPercent: fraction * 100,
    edge: stats.edge,
    roi: stats.roi,
  };
}
export function impliedFromAmerican(line) {
  const n = Number(line);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
export function noVigTwoWay(a, b) {
  const pa = impliedFromAmerican(a), pb = impliedFromAmerican(b);
  if (pa === null || pb === null || pa + pb <= 0) return null;
  return [pa / (pa + pb), pb / (pa + pb)];
}
