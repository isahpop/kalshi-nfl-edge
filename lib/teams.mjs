export const TEAMS = [
  ['Arizona Cardinals','ARI','Arizona','Cardinals'],['Atlanta Falcons','ATL','Atlanta','Falcons'],
  ['Baltimore Ravens','BAL','Baltimore','Ravens'],['Buffalo Bills','BUF','Buffalo','Bills'],
  ['Carolina Panthers','CAR','Carolina','Panthers'],['Chicago Bears','CHI','Chicago','Bears'],
  ['Cincinnati Bengals','CIN','Cincinnati','Bengals'],['Cleveland Browns','CLE','Cleveland','Browns'],
  ['Dallas Cowboys','DAL','Dallas','Cowboys'],['Denver Broncos','DEN','Denver','Broncos'],
  ['Detroit Lions','DET','Detroit','Lions'],['Green Bay Packers','GB','Green Bay','Packers'],
  ['Houston Texans','HOU','Houston','Texans'],['Indianapolis Colts','IND','Indianapolis','Colts'],
  ['Jacksonville Jaguars','JAX','Jacksonville','Jaguars','JAC'],['Kansas City Chiefs','KC','Kansas City','Chiefs'],
  ['Las Vegas Raiders','LV','Las Vegas','Raiders'],['Los Angeles Chargers','LAC','LA Chargers','Chargers','Los Angeles C'],
  ['Los Angeles Rams','LAR','LA Rams','Rams','Los Angeles R'],['Miami Dolphins','MIA','Miami','Dolphins'],
  ['Minnesota Vikings','MIN','Minnesota','Vikings'],['New England Patriots','NE','New England','Patriots'],
  ['New Orleans Saints','NO','New Orleans','Saints','NOLA'],['New York Giants','NYG','NY Giants','Giants','New York G'],
  ['New York Jets','NYJ','NY Jets','Jets','New York J'],['Philadelphia Eagles','PHI','Philadelphia','Eagles'],
  ['Pittsburgh Steelers','PIT','Pittsburgh','Steelers'],['San Francisco 49ers','SF','San Francisco','49ers'],
  ['Seattle Seahawks','SEA','Seattle','Seahawks'],['Tampa Bay Buccaneers','TB','Tampa Bay','Buccaneers'],
  ['Tennessee Titans','TEN','Tennessee','Titans'],['Washington Commanders','WAS','Washington','Commanders']
];
function normalize(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function matchTeam(text, candidates) {
  const query = normalize(text);
  if (!query) return null;
  const candidateSet = new Set(candidates || TEAMS.map(t => t[0]));
  const matches = TEAMS.filter(t => candidateSet.has(t[0]) && [...t, `${t[1]} ${t[3]}`].some(alias => normalize(alias) === query));
  return matches.length === 1 ? matches[0][0] : null;
}
const codesForTeam = name => {
  const row = TEAMS.find(team => team[0] === name);
  if (!row) return [];
  // Full names/cities should not be treated as abbreviations inside event tickers.
  return row.slice(1).filter(alias => /^[A-Z]{2,4}$/.test(alias));
};

export const isKalshiOpen = market => ['active', 'open'].includes(market?.status);

export function matchEventForMarket(market, events, now = Date.now()) {
  // A market that cannot be uniquely matched receives NO bookmaker-derived price.
  if (!market?.ticker?.startsWith('KXNFLGAME-') || !isKalshiOpen(market)) return null;
  const matches = [];
  const eventTicker = market.event_ticker || market.ticker?.split('-').slice(0,2).join('-');
  const encodedPair = /^KXNFLGAME-\d{2}[A-Z]{3}\d{2}([A-Z]+)$/.exec(eventTicker || '')?.[1] || null;
  for (const event of events || []) {
    const teams = [event.home_team, event.away_team];
    // Kalshi sometimes abbreviates its selection label (e.g., "New York G").
    // Permit ticker fallback only when its suffix uniquely identifies a listed team.
    const suffix = market.ticker.split('-').at(-1);
    const labelSelection = matchTeam(market.yes_sub_title, teams);
    const suffixMatches = teams.filter(team => codesForTeam(team).includes(suffix));
    const selection = labelSelection || (suffixMatches.length === 1 ? suffixMatches[0] : null);
    if (labelSelection && suffixMatches.length === 1 && labelSelection !== suffixMatches[0]) continue;
    if (!selection || teams[0] === teams[1]) continue;
    const other = teams.find(t => t !== selection);
    const title = normalize(`${market.title || ''} ${market.subtitle || ''}`);
    const opposite = TEAMS.find(t => t[0] === other);
    const selectedRow = TEAMS.find(t => t[0] === selection);
    if (!opposite || !selectedRow) continue;
    const possiblePairs = codesForTeam(selection).flatMap(a => codesForTeam(other).flatMap(b => [a+b,b+a]));
    if (encodedPair && !possiblePairs.includes(encodedPair)) continue; // event ticker must agree with sportsbook teams
    const titleIdentifiesOpponent = opposite.some(a => normalize(a).length >= 4 && title.includes(normalize(a)));
    if (!titleIdentifiesOpponent && !encodedPair) continue; // need two independently identified teams
    const marketTime = Date.parse(market.occurrence_datetime || market.expected_expiration_time || market.close_time || '');
    const eventTime = Date.parse(event.commence_time || '');
    // A three-hour gap appears in the provider data we received. Keep it as a
    // *reference-only* matchup, never as a trade-qualified signal. Reject larger gaps.
    if (!Number.isFinite(marketTime) || !Number.isFinite(eventTime) || eventTime <= now || Math.abs(marketTime - eventTime) > 6 * 3600000) continue;
    matches.push({ event, selection, kickoffGapMinutes: Math.round(Math.abs(marketTime-eventTime)/60000) });
  }
  return matches.length === 1 ? matches[0] : null;
}
