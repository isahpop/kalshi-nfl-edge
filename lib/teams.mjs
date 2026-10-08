export const TEAMS = [
  ['Arizona Cardinals','ARI','Arizona','Cardinals'],['Atlanta Falcons','ATL','Atlanta','Falcons'],
  ['Baltimore Ravens','BAL','Baltimore','Ravens'],['Buffalo Bills','BUF','Buffalo','Bills'],
  ['Carolina Panthers','CAR','Carolina','Panthers'],['Chicago Bears','CHI','Chicago','Bears'],
  ['Cincinnati Bengals','CIN','Cincinnati','Bengals'],['Cleveland Browns','CLE','Cleveland','Browns'],
  ['Dallas Cowboys','DAL','Dallas','Cowboys'],['Denver Broncos','DEN','Denver','Broncos'],
  ['Detroit Lions','DET','Detroit','Lions'],['Green Bay Packers','GB','Green Bay','Packers'],
  ['Houston Texans','HOU','Houston','Texans'],['Indianapolis Colts','IND','Indianapolis','Colts'],
  ['Jacksonville Jaguars','JAX','Jacksonville','Jaguars'],['Kansas City Chiefs','KC','Kansas City','Chiefs'],
  ['Las Vegas Raiders','LV','Las Vegas','Raiders'],['Los Angeles Chargers','LAC','LA Chargers','Chargers'],
  ['Los Angeles Rams','LAR','LA Rams','Rams'],['Miami Dolphins','MIA','Miami','Dolphins'],
  ['Minnesota Vikings','MIN','Minnesota','Vikings'],['New England Patriots','NE','New England','Patriots'],
  ['New Orleans Saints','NO','New Orleans','Saints'],['New York Giants','NYG','NY Giants','Giants'],
  ['New York Jets','NYJ','NY Jets','Jets'],['Philadelphia Eagles','PHI','Philadelphia','Eagles'],
  ['Pittsburgh Steelers','PIT','Pittsburgh','Steelers'],['San Francisco 49ers','SF','San Francisco','49ers'],
  ['Seattle Seahawks','SEA','Seattle','Seahawks'],['Tampa Bay Buccaneers','TB','Tampa Bay','Buccaneers'],
  ['Tennessee Titans','TEN','Tennessee','Titans'],['Washington Commanders','WAS','Washington','Commanders']
];
function normalize(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function matchTeam(text, candidates) {
  const query = normalize(text);
  if (!query) return null;
  const candidateSet = new Set(candidates || TEAMS.map(t => t[0]));
  const matches = TEAMS.filter(t => candidateSet.has(t[0]) && t.some(alias => normalize(alias) === query));
  return matches.length === 1 ? matches[0][0] : null;
}
export function matchEventForMarket(market, events) {
  // Avoid assigning a sportsbook probability to a different game, team or contract type.
  // Restricted to KXNFLGAME moneyline selections; don't compare spread/prop contracts.
  if (!market.ticker?.startsWith('KXNFLGAME-')) return null;
  for (const event of events) {
    const teams = [event.home_team, event.away_team];
    const selection = matchTeam(market.yes_sub_title, teams);
    if (!selection) continue;
    const other = teams.find(t => t !== selection);
    const normalizedTitle = normalize(`${market.title || ''} ${market.subtitle || ''}`);
    const otherTeam = TEAMS.find(t => t[0] === other);
    const opponentMentioned = otherTeam && [otherTeam[0],otherTeam[1],otherTeam[2],otherTeam[3]].some(a => a.length > 2 && normalizedTitle.includes(normalize(a)));
    if (!opponentMentioned) continue;
    const marketTime = new Date(market.expected_expiration_time || market.close_time || 0).getTime();
    const eventTime = new Date(event.commence_time || 0).getTime();
    if (!Number.isFinite(marketTime) || !Number.isFinite(eventTime) || Math.abs(marketTime - eventTime) > 60*60*1000*48) continue;
    return { event, selection };
  }
  return null;
}
