# NFL Edge Lab — V1

Read-only NFL Kalshi market scanner with **real market prices**, optional no-vig sportsbook consensus, manually adjustable probabilities, **$200 paper bankroll**, quarter-Kelly sizing capped at 5% of bankroll, and locally saved paper trades.

**Not a real-money trading bot.** No order endpoints are called. Edge and sizing figures are before Kalshi fees, slippage, bid/ask size constraints, and taxes. Positive modeled EV is not proof of profitable trading. Match rules are conservative: no automatic probabilities if the market cannot be confidently matched to a sportsbook game.

## Launch locally

1. Install Node 20+.
2. `npm install`
3. Optionally copy `.env.example` to `.env.local`, set `ODDS_API_KEY` from https://the-odds-api.com (not your Kalshi API key).
4. `npm run dev` then visit http://localhost:3000
5. `npm test` for calculation checks; `npm run build` before deployment.

## Publish with GitHub + Vercel

1. Upload **the contents of this project folder** (not the ZIP itself) to the root of `isahpop/kalshi-nfl-edge` on the `main` branch using GitHub **Add file → Upload files**.
2. Since the repository is already linked to Vercel, a push to `main` should start a deployment.
3. In Vercel → `kalshi-nfl-edge` → **Settings → Environment Variables**, optionally create `ODDS_API_KEY` for **Production** and **Preview**. Do not put API keys in GitHub source files or browser inputs.
4. Redeploy after adding env vars. Check Vercel's Deployments tab and click the assigned deployment URL.

## What V1 supports

- Kalshi public **NFL game winner** markets only, series `KXNFLGAME`; not spreads, totals, player props or futures yet.
- Live public YES and NO ask quotes (if available) from Kalshi; the API is requested by a server route and cached ~45 seconds.
- Optional The Odds API NFL H2H odds, cached ~3 minutes; multi-book de-vig consensus calculated only when a conservative team/game match is found.
- Manual fair probability override for analysis; inputs are stored in your browser only.
- Pre-fee expected value and expected ROI; best available side chosen between YES and NO.
- Quarter Kelly (25% of full Kelly) and an additional 5%-of-bankroll limit; contracts rounded down.
- Paper trades saved only to browser localStorage and exportable as CSV; no account sync or settlement automation.

## Security

Do not commit credentials. Kalshi public endpoints don't need your authenticated key; V1 intentionally does not use it. Bookmaker key is read only on the server. Any actual order/trading integration would need a separate security, compliance, risk-controls and auth review. For multi-device synchronization, add a hosted database and authenticated user accounts before storing sensitive data.
