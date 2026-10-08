# NFL Edge Lab — V2.1 (SportsGameOdds Free) fee-aware paper scanner

NFL `KXNFLGAME` (game-winner) research dashboard for Kalshi. **No real-money trades, no Kalshi private API access, no promise of a profitable strategy.**

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
- The **qualified signals** filter requires positive **net edge ≥2 percentage points**, a verifiable fee multiplier, known depth, bid/ask spread ≤12 percentage points, and an API snapshot ≤3 minutes old. `updated_time` in the market API is metadata-only; it is **not a quote timestamp**. Quotes and displayed depth are not guarantees of execution.
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

1. Extract the V2.1 ZIP in Apple's Files app.
2. Copy the **contents** of the included project folder into **Locations → Working Copy → kalshi-nfl-edge**. Replace the existing `app`, `lib`, `README.md`, `package.json`, and other same-name files as prompted. Keep `.gitignore`; do not copy an extra outer `kalshi-nfl-edge-v2` folder into the repository.
3. Return to Working Copy, verify `app`, `lib`, and root project files, then **Commit → Push** to `main`.
4. Vercel automatically builds a new production deployment. Visit the latest preview/production URL and confirm `/api/scan` responds.

## Testing

`npm test` uses Node's built-in test runner for the financial math, pricing/qualification rules, market matching, feeds, and ledger outcomes. `npm run build` validates the Next.js production build (requires dependencies to be installed).

**Disclaimer:** Research prototype, not financial advice or an automated trading system.

## SportsGameOdds Amateur free-plan controls

- **Key:** `SPORTSGAMEODDS_API_KEY` added **only** in Vercel Settings → Environment Variables → Production (and Preview if needed). Do not paste an actual key into `.env.example`, GitHub or chat.
- API: `GET https://api.sportsgameodds.com/v2/events`, header `x-api-key` (never a URL parameter). Filter: `leagueID=NFL`, pregame events in the next 8 days, and **full-game home + away moneylines only**.
- Free plan as of Oct 2026: 10 requests/minute; 2,500 returned objects per rolling 30-day period; updates roughly every 10 minutes. **Our own server intentionally caches 8 hours.** At an assumed maximum 20 events and three fetches daily, 30 days would consume ~1,800 event objects, **not a guarantee**—cache misses, extra redeployments and outside use can change actual consumption. Check your provider dashboard and `/v2/account/usage`.
- Fetches only one page (max 20 events); warns on pagination and provider access notices. **Does not automatically retry rate-limit responses**.
- Require 3 distinct bookmakers with **both sides available**, verified line update timestamps, and within 15 minutes of each other. Calculate median no-vig implied probabilities ourselves. Never use Kalshi as a source of fair probability.
- When old odds are cached, their valuations can still be displayed as *research only*, but signals are disqualified once the oldest contributing sportsbook quote is over **60 minutes** old. This avoids treating 8-hour-old bookmaker prices as a current opportunity.
- Public scan route is protected by Vercel/Next.js caching but not a strict usage-budget lock. If usage approaches 2,500 objects, disable provider key or add durable backend budgeting. Do not repeatedly redeploy or purge caches on the free plan.

### How to deploy this update from Working Copy on iPhone

If following the steps above, you can set the key in Vercel **before** pushing V2.1, which avoids an extra redeployment. Then use `/api/scan` to verify provider status. Automatic signals may be absent when bookmaker quotes are stale or do not satisfy the quality gates.
