# NFL Edge Lab — V2.8: Timestamped Paired Odds Evidence

V2.8 is a **full project** update that collects sportsbook no-vig reference probabilities only in a handful of pregame NFL windows, and archives each qualifying comparison **inside the existing GitHub-synchronized Kalshi price snapshot**. No new key, GitHub secret, provider subscription, or workflow editing is required. It remains a **research/paper-only** engine.

## What changed

- `lib/paired-evidence.mjs` computes independent sportsbook de-vig probabilities for uniquely matched Kalshi game-winner markets. Requires **3+ paired bookmakers** with consensus range ≤8 percentage points and timestamps whose **oldest** quote is ≤60 minutes old at Kalshi capture time. Refuses started games, invalid selection IDs, quote staleness, and inconsistent data.
- `scripts/collect-quotes.mjs` continues to save Kalshi quotes every two hours. It requests a sportsbook snapshot **only on Sun 16:xx and 20:xx UTC, Mon 22:xx UTC, and Thu 22:xx UTC**, or during an explicitly triggered GitHub workflow run. The same GitHub workflow still commits `data/snapshots/*.jsonl` and `public/data/kalshi-history.json`. No new GitHub permissions. A public `https://kalshi-nfl-edge.vercel.app/api/odds` route is used; your secret API key stays on Vercel. The existing 8-hour Vercel sportsbook fetch cache is retained.
- New stored `bookPair` records contain observed timestamps, bookmaker counts, age, consensus and one-contract estimated cost/edge **as they existed at collection time**, rather than reconstructing the reference after the game. A source error is archived as an unavailable attempt, never invented as zero edge. If the `/api/odds` endpoint cannot be accessed by GitHub Actions, ordinary Kalshi capture continues and the dashboard reports the error.
- The scanner's *Paired odds evidence* panel shows counts, attempted/successful windows, prospective fee-adjusted **research screens** (not automatic trade-qualified signals), and later one-contract settlement arithmetic **only after verified official Kalshi outcomes**.
- A hypothetical settlement row uses only the **first qualifying screen per game**, and subtracts one-contract ask + estimated Kalshi taker fee + 1¢ slippage. It assumes a fill despite no order ever being sent. It is **not real profit**, not risk-sized, and not a valid live portfolio ROI. It has no independent verification of game kickoff and does not claim market-edge certainty.

**Very important: the working public odds route has not been confirmed accessible from a GitHub Actions runner.** After pushing V2.8, manually run the existing GitHub Action once and inspect the new dashboard section. A 403/502 is a source-access limitation to investigate, not a reason to put the private sportsbook key in GitHub or weaken the freshness checks.

## Install safely from iPhone / Working Copy

1. Pull in Working Copy immediately before replacing code: scheduled Actions can add newer commits while you work.
2. Extract the entire ZIP; open `kalshi-nfl-edge-starter` and copy its CONTENTS into the existing repo root, merging folders and replacing older **source** files.
3. **Keep newer `data/snapshots/*.jsonl` and `public/data/kalshi-history.json` in Working Copy.** The ZIP includes the earliest verified 58-contract snapshot for backup, not necessarily the newest auto-collected data. Do not reset them. Do not delete existing snapshot dates.
4. `.github/workflows/collect-kalshi-prices.yml` is included for completeness but **does not need changing**. V2.8 works with the existing installed workflow.
5. Commit `Add paired NFL sportsbook evidence and forward screens (V2.8)` and Push to `main`. Confirm Vercel deployment READY.
6. To attempt a sportsbook pairing immediately, open GitHub → Actions → **Collect Kalshi public NFL prices** → **Run workflow** on `main`. A manually dispatched workflow is intentionally allowed to try one sportsbook reference. It uses the existing cache and requires no API key on GitHub. Existing raw data is not replaced. Pull the resulting automatic GitHub commit before your next manual change.

## Free-plan budget and safety

SportsGameOdds currently documents **2,500 returned event objects per rolling monthly allowance**, per its official [rate-limit guide](https://sportsgameodds.com/docs/info/rate-limiting). The existing request targets up to 20 NFL events per 8-hour URL/cache window. Four automated prospective captures per week could potentially cause up to roughly 320 additional objects in four weeks **if all were independent cache misses**; the real incremental use may be lower due to existing shared caching. This is not a guarantee: other dashboard traffic, cache invalidations, manual runs, and user account activity all count toward your actual provider allowance. We do not currently have quota-meter readings. If usage becomes tight, disable extra reference calls until it resets.

The collector **never places Kalshi orders**, stores API secrets, exports full bookmaker feeds, guarantees fills, or uses experimental EPA/Elo to qualify live trades. Observed quote comparisons are *evidence to test*, not evidence of profitability. Data collection schedule depends on GitHub Actions timing, upstream feeds, and Vercel public-route accessibility.

---

# NFL Edge Lab — V2.7 complete project

**This archive contains the entire Next.js project, not just the update patch.**

V2.7 adds a public Kalshi settlement/outcome ledger, observed price-movement
rankings, and graceful recovery from settlement lookup failures. The outcome
records and quotes are for research only; no money is wagered or orders sent.

**For existing Working Copy installs:** Read `START-HERE.txt` before copying.
Pull the repository first; automated GitHub Actions commits may contain newer
`data/snapshots` and `public/data/kalshi-history.json` data than the ZIP. The
complete backup contains the first verified 58-contract snapshot as of
2026-10-08 21:25:07 UTC. Do not overwrite newer collected observations.

---

# V2.6 — Training holdout and scheduled public Kalshi price capture

## Deploying from your iPhone

1. Extract the **full V2.6 project ZIP** and replace the existing root contents in Working Copy.
2. **Verify the hidden `.github/workflows/collect-kalshi-prices.yml` file has been copied.** Without that file, automated quote collection cannot run. Check `lib/calibration.mjs`, `lib/price-history.mjs`, and `scripts/collect-quotes.mjs` are also present.
3. Commit `Add calibrated model tests and public Kalshi history (V2.6)` and push to `main`.
4. In GitHub, visit **Actions → Collect Kalshi public NFL prices**. If Actions is not enabled, enable workflows for this repository. Select **Run workflow** once to trigger an initial capture. The scheduler normally runs every 2 hours (timing can be delayed by GitHub).
5. Confirm the workflow generated `data/snapshots/YYYY-MM-DD.jsonl` and `public/data/kalshi-history.json`. The dashboard history section may lag until a Vercel production rebuild. **Pull** recent remote commits in Working Copy before your next manual commit, since the collector commits new data to `main`.

No new API key required. The workflow uses public Kalshi API endpoints only and **never** requests SportsGameOdds or places orders. GitHub Actions must have `contents:write` access; repositories with restrictive Actions policies may need you to enable workflow write permission in repo **Settings → Actions → General**.

## What the model lab actually measures

- Trains two fixed-regularization logistic calibrators on 2023–2024 historical games: Elo only, and Elo plus the weekly EPA proxy.
- Evaluates them on **the same eligible 2025 games** as raw Elo, EPA, and a historical no-vig sportsbook benchmark. Reports Brier score, log loss, and five-bin calibration, with an approximate unpaired-games 95% interval for the Elo+EPA-minus-sportsbook Brier gap.
- 2025 outcomes have **no influence on fitted coefficients**, but previous V2.4 and V2.5 experiments exposed 2025 outcomes to us. Therefore 2025 is a **fitting holdout, not a pristine untouched blind test**. Future forward-only seasons are needed for a genuinely fresh validation.
- All game-date predictions are formed **before** updating ratings or EPA with **any** completed game from the same date. Current-year updates use past results only. Experimental calibrated forecasts **never** affect sportsbook fair values, order qualification, Kelly sizing, or paper returns.
- Current or historical quarterback changes, injuries, weather, market-line collection time, Kalshi fills, taxes, and model uncertainty are not yet modeled.

## Quote intelligence, not profits

- Public quote collector stores timestamped YES/NO top-of-book asks, bids, visible ask depth, volume, fee multiplier if verified, and ticker in daily append-only JSONL.
- An approximately 14-day summary is exposed as `public/data/kalshi-history.json`. The full raw daily archive persists in GitHub. **No price history exists until the first successful workflow run.**
- Displays observed price change only. An ask-price movement is **not** a trade, fill, settlement, guaranteed arbitrage, ROI, or closing-line value estimate.
- Sportsbook odds are **not yet archived** with these timestamps. Historical bookmaker values in nflverse have unverified collection timestamps; do not claim a historical actionable Kalshi edge based on them.
- The scheduled collector commits to GitHub; automatic Vercel redeploys on bot-generated commits can depend on your integration configuration. If the site shows zero snapshots after the data files exist, first verify whether Vercel has deployed that bot commit.

---

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

## V2.7: Public settlement tracker and quoted price movements

- The **existing** `Collect Kalshi public NFL prices` GitHub Actions workflow runs the enhanced `scripts/collect-quotes.mjs`. No workflow edit, new API key, extra GitHub secret, or SportsGameOdds data is required.
- Each collection still appends current public game-winner quotes to `data/snapshots/YYYY-MM-DD.jsonl` and updates `public/data/kalshi-history.json`. A separate bounded request checks public Kalshi **settled** game-winner markets over a 21-day window. Only settlements matching contracts we previously archived are displayed.
- Published YES/NO results are interpreted as $1/$0 payout for a YES contract unless Kalshi provides a numeric settlement payout, which takes precedence. Void/partial settlements are not mislabeled wins or losses; unknown results are excluded.
- **Failure-safe:** the collector continues saving price snapshots if the settlement endpoint is down or paginated beyond its safety bound. Previously verified settlement data is retained as stale and a warning is shown.
- The dashboard shows largest YES ask movements between first and most recent observed snapshots and a verified settlement tracker. It **does not** call those quotes fills, infer model profitability, or use future settlements to rank earlier decisions.
- **Only install the V2.7 patch after using Pull in Working Copy** to synchronize GitHub Actions' bot commits. Copy the changed files into existing paths, preserving `data/snapshots`, `public/data/kalshi-history.json`, and `.github/workflows/collect-kalshi-prices.yml`. When the next scheduled job runs, the settlement section will populate. Most upcoming NFL markets will remain unresolved until games finish.

The project still has no audited positive-return strategy. Next step: collect **paired timestamped sportsbook consensus** at a limited cadence that respects the provider's free allowance and test prospective, pre-registered signals without hindsight.
