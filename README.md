# NFL Edge Lab — V2.5 (Experimental EPA proxy + walk-forward model lab)

NFL `KXNFLGAME` (game-winner) research dashboard for Kalshi. **No real-money trades, no Kalshi private API access, no promise of a profitable strategy.**


## V2.5: NFL weekly EPA model lab

- **New public-data input:** nflverse **weekly team summary statistics** for 2023–2026, fetched from official public GitHub release assets (`stats_team_week_YYYY.csv`), cached for **12 hours** by the Next.js server. This is independent of the SportsGameOdds key and does not use its object allowance. A failed upstream download is shown as a source-availability notice and **does not stop** Kalshi + sportsbook + Elo scans.
- **Precise label:** This is an *experimental EPA proxy*, not exact raw-play EPA/play. Team passing QB-EPA and rushing EPA are summed, then divided by `(attempts + sacks_suffered + carries)` (an approximate play denominator). Opposing teams' offensive EPA proxy serves as defense EPA allowed. EPA sources/denominators can differ from nflfastR per-play tables.
- **Prediction design:** recent 8 games receive exponentially declining weights (0.84 per older game); ratings are shrunk toward 0 when the sample is small. Team offense is compared against the opponent's defense-allowed and converted to a bounded logistic home-win estimate. The slope **3.5** and +0.1 home-logit are **heuristics**, not optimized on training data and not proven predictive. At least four paired games per team are required.
- **Research-only model stack:** book consensus is still the ONLY automatic fair probability for pricing. Basic score-based Elo, weekly EPA proxy, and a fixed **50/50 Elo/EPA blend** appear **separately** in the market board. None are used to qualify orders, calculate Kelly stakes, or override sportsbook probabilities.
- **Honest evaluation:** Each completed game is predicted using only prior game records. For the 2025 holdout, the model compares EPA, score-only Elo, the fixed blend, and historical pregame moneyline-implied probabilities on the **same games** whenever EPA coverage and moneyline columns are available. All results use Brier score (**lower is better**). The nflverse moneyline columns have **unverified collection timestamps**: avoid calling them guaranteed closing prices. No tuning was done on the holdout, and a single-season comparison is not a statistically validated or profitable strategy.
- **Operational caveats:** The weekly files are hosted on GitHub releases and might be temporarily unavailable, stale, or subject to GitHub's outgoing fetch restrictions. The interface reports missing seasons, most recent completed EPA game, and whether predictions are available; do **not** interpret an unavailable source as a zero-strength team. A full Vercel build and real external feed test must be completed after deployment.

### Deployment

As with previous versions, extract the included `kalshi-nfl-edge-starter` folder and replace project contents **at the root** of your iPhone Working Copy checkout. Commit: `Add experimental EPA model lab and walk-forward evaluation (V2.5)`, then Push. No environment-variable changes are required. Once deployed, check the **EPA** filter, the **EPA model lab** section and `/api/scan`'s `epa` field to verify upstream availability. 

## V2.3 improvements

- Dashboard now explains how many modeled contracts show **positive fee-adjusted value**, clear the **2-point threshold**, and pass **all quality checks**. Shows the most frequent blocker reasons. These are research numbers, not proof of value in actual executions.
- Removes the misleading *cannot afford one contract* warning on negative-edge positions: **zero Kelly is intentional when expected value is negative**. For positive-edge opportunities too small to size, warns that the calculated Kelly allocation is less than one contract.
- Displays **one-contract hypothetical fee** separately from a multi-contract order fee; a 0-contract suggested stake does not mean trading would be fee-free.
- Displays SportsGameOdds reported kickoff time and the Kalshi event timestamp separately when a game is matched. A consistent 180-minute difference is flagged but **not ignored or automatically fixed**: verified independent kickoff data is still needed before labeling it an actionable signal.
- Remains paper-trading only. No live execution. Free-tier cache still means estimates can be stale; do not bet on old odds.

## Quick start

```bash
npm install
npm test
npm run dev
# Optional: npm run build
```

- The dashboard shows public Kalshi YES/NO *ask* prices, price spreads, and reported visible depth. It requests up to six pages of currently open NFL game-winner markets from Kalshi and reports truncation.
- A separate **server-side** SportsGameOdds feed produces our own median **no-vig** implied probabilities from paired book moneylines (not Kalshi or provider fairOdds). Only pregame, uniquely matched games with **at least 3 different books** and at most 8 percentage points of disagreement receive automatic fair-value estimates. Model reference prices can be cached for up to 8 hours, but only bookmaker quotes no older than 60 minutes qualify as potential signals.
- Fees use the general **quadratic taker fee** (0.07 × multiplier × contracts × price × (1−price), rounded *up per order* to the nearest cent), obtaining the **series multiplier from Kalshi** when available. Other fee exceptions or promotions may differ. Adds an extra **1¢ of simulated slippage per contract**, configurable in `lib/engine.mjs`.
- The **qualified signals** filter requires positive **net edge ≥2 percentage points**, a verifiable fee multiplier, known depth, bid/ask spread ≤12 percentage points, and an API snapshot ≤3 minutes old. Kalshi returns `status: "active"` for its open market contracts; both `active` and `open` are supported. `updated_time` in the market API is metadata-only; it is **not a quote timestamp**. Quotes and displayed depth are not guarantees of execution.
- **Cross-provider kickoff discrepancies:** An exact team/ticker match with a kickoff-time difference of up to 6 hours may be shown as *reference-only*, but any difference over 45 minutes suppresses qualified signals. The October 8 live samples showed a 3-hour discrepancy; this should be investigated, not silently corrected by guessing the right time zone.
- Paper positions use **quarter Kelly** based on estimated fee-adjusted breakeven: **5% maximum per simulated order, 10% per NFL game, 25% total open exposure**, starting with **$200**. A simulated order never exceeds reported best-ask size when known.
- The **paper journal** stores positions only in browser `localStorage`. Mark outcomes manually as won/lost/void to record *simulated* realized P&L. CSV/JSON exports are available; there is no cross-device sync or auto-settlement.

### Configure independent odds (necessary for automatic signals)

1. Obtain a separate developer key from [SportsGameOdds](https://sportsgameodds.com). Your Kalshi private API key is **not** required for the read-only scanner and cannot replace a bookmaker feed.
2. In Vercel, go to **kalshi-nfl-edge → Settings → Environment Variables**. Add `SPORTSGAMEODDS_API_KEY` as a **sensitive server-side variable**, selecting **Production** (and Preview if needed). Paste its value **in Vercel only**, never in GitHub files, a screenshot, or chat.
3. Redeploy from Vercel's Deployments tab after configuring the variable. Then click **Refresh** in the dashboard. The sportsbook feed is cached for 8 hours to conserve the free plan object allowance. That makes it suitable for research, NOT instant actionable alerts.
4. Automatic signals may still show zero even with a working key if no well-matched, liquid, independently mispriced events clear the thresholds. This is expected and preferable to fabricated edges.

For local development use `.env.local` (Git-ignored): `SPORTSGAMEODDS_API_KEY=your_private_key`.

### Read-only endpoints

- `GET /api/markets` — public Kalshi open `KXNFLGAME` markets, pagination metadata, fee multiplier/verification.
- `GET /api/odds` — independent NFL H2H bookmaker events if configured, no API key is exposed.
- `GET /api/scan` — complete fee-aware scan with qualification flags and exclusion reasons; paper-only.

### Model limitations / verify before acting

- **Consensus is a cross-market comparison, not an independently trained football win model**. Bookmakers can be wrong or correlated, and their margins/settlement rules differ from Kalshi.
- Kalshi NFL tie outcomes may settle at **$0.50 per side**; this engine's simplified two-outcome model does not separately estimate ties. Reschedules, rule changes, promotions, settlement quirks and taxes aren't modeled.
- The simulator assumes a current best ask and an extra slippage buffer, not a real execution at that price. Fast price changes, order fees, shallow liquidity, and market impact can erase an apparent model advantage.
- No alerts, automatic execution, historical time series, statistically validated backtests, production-grade account access, or performance proof yet. Do not infer positive expected profits are reliably attainable.
- Only NFL `KXNFLGAME` moneylines are included; spreads, totals, and player props require different matching/settlement logic and should never be compared against moneylines.

### Deploy from an iPhone with Working Copy

1. Extract the V2.3 ZIP in Apple's Files app.
2. Copy the **contents** of the included `kalshi-nfl-edge-starter` folder into **Locations → Working Copy → kalshi-nfl-edge**. Replace the existing `app`, `lib`, `README.md`, `package.json`, and other same-name items when prompted. Keep the existing `.gitignore`; do not add an extra outer `kalshi-nfl-edge-starter` folder into the repository.
3. Return to Working Copy, verify `app`, `lib`, and root project files, then **Commit → Push** to `main`.
4. Vercel automatically builds a new production deployment. Visit the latest preview/production URL and confirm `/api/scan` responds.

## Testing

`npm test` uses Node's built-in test runner for the financial math, pricing/qualification rules, market matching, feeds, and ledger outcomes. `npm run build` validates the Next.js production build (requires dependencies to be installed).

**Disclaimer:** Research prototype, not financial advice or an automated trading system.

## SportsGameOdds Amateur free-plan controls

- **Key:** `SPORTSGAMEODDS_API_KEY` added **only** in Vercel Settings → Environment Variables → Production (and Preview if needed). Do not paste an actual key into `.env.example`, GitHub or chat.
- API: `GET https://api.sportsgameodds.com/v2/events`, header `x-api-key` (never a URL parameter). Filter: `leagueID=NFL`, pregame events in the next 8 days, and **full-game home + away moneylines only**.
- Free plan as of Oct 2026: 10 requests/minute; 2,500 returned objects per rolling 30-day period; updates roughly every 10 minutes. **Our own server requests the same stable URL for each 8-hour window so the Next.js fetch cache can be effective.** At an assumed maximum 20 events and three fetches daily, 30 days would consume ~1,800 event objects, **not a guarantee**—cache misses, extra redeployments and outside use can change actual consumption. Check your provider dashboard and `/v2/account/usage`.
- Fetches only one page (max 20 events); warns on pagination and provider access notices. **Does not automatically retry rate-limit responses**.
- Require 3 distinct bookmakers with **both sides available**, verified line update timestamps, and within 15 minutes of each other. Calculate median no-vig implied probabilities ourselves. Never use Kalshi as a source of fair probability.
- When old odds are cached, their valuations can still be displayed as *research only*, but signals are disqualified once the oldest contributing sportsbook quote is over **60 minutes** old. This avoids treating 8-hour-old bookmaker prices as a current opportunity.
- Public scan route is protected by Vercel/Next.js caching but not a strict usage-budget lock. If usage approaches 2,500 objects, disable provider key or add durable backend budgeting. Do not repeatedly redeploy or purge caches on the free plan.

### How to deploy this update from Working Copy on iPhone

The `SPORTSGAMEODDS_API_KEY` environment variable you configured previously is sufficient. Do not create a new key. After pushing V2.3, use `/api/scan` to verify `modeled > 0` on a matching slate. `qualified` can still be zero when kickoff times disagree, or bookmaker quotes are stale, or thresholds are not met.


## V2.4: Public NFL schedule cross-check and experimental Elo

The scanner optionally retrieves the public NFL schedule and completed results from the
[nflverse/nfldata games.csv](https://github.com/nflverse/nfldata/blob/master/data/games.csv)
source (six-hour Next.js fetch cache). This extra data source does **not** consume the SportsGameOdds quota.
The schedule verifies bookmaker kickoff time using the game date and the Eastern scheduled time,
while Kalshi's `occurrence_datetime` is shown distinctly and is **not** assumed to be kickoff.
If the nflverse source is unavailable or ambiguous, the original timing check is retained.

A transparent, **experimental** Elo baseline is built from final scores (starting with 2022),
using K=20, a 45-point home-field prior, and two-thirds of rating carried from season to season.
Unlike FiveThirtyEight's full model and nfelo, this is intentionally *not* their exact forecast:
there are no QB, injury, travel, EPA, or market-informed strength adjustments.
The separate `Elo gaps` research tab ranks sportsbook/Elo disagreement, but Elo results
**never qualify a betting signal**, change the displayed sportsbook consensus, or authorize trades.
The 2025 walk-forward Brier score is only an illustrative diagnostic; it does not establish ROI.

Sources and attribution:
- nflverse/nfldata: https://github.com/nflverse/nfldata (schedule and final scores; original data contributors credited)
- nflverse data ecosystem: https://github.com/nflverse/nflverse-data
- FiveThirtyEight NFL Elo concepts: https://fivethirtyeight.com/methodology/how-our-nfl-predictions-work/
- nfelo open-source research: https://github.com/greerreNFL/nfelo

Do not imply that third-party model code has been incorporated directly or that commercial
forecast feeds are freely licensed for reuse. No live trading orders are sent.
