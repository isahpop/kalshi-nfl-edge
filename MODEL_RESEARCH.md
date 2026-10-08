# NFL Edge Lab — Models and validation plan (V2.4)

## Three distinct things we should not conflate

1. **Independent market benchmark:** SportsGameOdds NFL full-game moneylines from at least three bookmakers; the current product computes a no-vig median. This is a *market-based estimate*, not an independent analytical model of player/team strength.
2. **Independent team-strength reference:** An experimental score-only Elo baseline calculated entirely from already-completed nflverse games. This helps study differences between team history and bookmaker pricing, but should *not* qualify betting signals by itself.
3. **Evidence of actual advantage:** A timestamped, reproducible, out-of-sample backtest and forward paper-trade results that include executable Kalshi ask prices, fees, slippage, settlement details, and calibration. **We do not have this evidence yet.**

## Existing research we evaluated

- FiveThirtyEight NFL Elo: [methodology](https://fivethirtyeight.com/methodology/how-our-nfl-predictions-work/). Adapts Elo ratings for home field, QB, margin of victory, travel and offseason regression. We implemented a *simpler, independently written* score-only Elo baseline inspired by Elo principles, **not** FiveThirtyEight's full algorithm.
- [nfelo](https://github.com/greerreNFL/nfelo): Publicly documented power ratings/prediction model, with work on player/QB ratings and advanced efficiency signals. Useful candidate for *benchmarking*, but no nfelo code or predictions are imported in V2.4. Check each upstream license and dataset usage permissions before copying or redistributing anything.
- [nflverse](https://github.com/nflverse/nflverse-data): Public research datasets and NFL play-by-play ecosystem. V2.4 reads public schedule and score fields from [nflverse/nfldata games.csv](https://github.com/nflverse/nfldata/blob/master/data/games.csv), not play-by-play or EPA yet. Attribution: nflverse and Lee Sharpe/nfldata contributors. Verify the latest applicable data licence before broader commercial use.

## Elo method implemented here

- Training history: completed NFL games from 2022 onward, in chronological order; no games in the future or today are used for updates.
- Ratings start at 1500, with K=20 and +45 Elo for the home team; neutral games receive no bonus. Ratings carry two-thirds into the next season. Ties count as half a win. **No** margin-of-victory, QB, injury, EPA, rest, lineup, or weather factors yet.
- Sample diagnostic: 2025 walk-forward Brier score (predictions generated *before* that game's result updates ratings), plus a same-game comparison against the historical no-vig closing line where available. The simple parameters were chosen upfront, not optimized for 2025 results. Brier scoring is not a betting profit backtest.
- Results are shown only if nflverse schedule confirms both team identities, the day, and kickoff within 15 minutes. A distinct three-hour Kalshi occurrence/estimated game end time is not mistaken for kickoff.
- Missing nflverse data leaves all original timing safety checks intact and suppresses Elo results. Elo never overrides bookmaker fair probabilities or creates a qualified trading signal.

## Backtest/forward-testing requirements before enabling an Elo-enhanced signal

1. Save timestamped market snapshots, including executable YES/NO asks, available depth, bid/ask spread and actual fee schedule. Do not use closing prices to simulate bets supposedly placed earlier.
2. Store the contemporaneous odds/reference outputs used at each decision timestamp; prevent look-ahead from injuries, QB changes, scores and future game results.
3. Benchmark Brier score, log loss, expected calibration error and ROI separately by season. Include a no-vig sportsbook benchmark and, where appropriately licensed, published nfelo forecasts.
4. Segment by price range, underdog/favorite, game time-to-kickoff, liquidity, and edge estimate. Report 95% uncertainty intervals and sample size.
5. Simulate fills realistically with ask price, depth, spread, taker fees, one-contract cent rounding, and risk limits; calculate settled profits after all costs.
6. Require a sufficiently large untouched validation period plus forward paper trading before upgrading any experimental model into signal generation.

## Free SportsGameOdds plan and data timeliness

Free tier is capped at 2,500 event objects per rolling 30 days and 10 requests/minute, per https://sportsgameodds.com/docs/info/rate-limiting. Each event returned is typically one object, not one object per bookmaker. The 8-hour stable-window cache reduces consumption but can cause *reference-only* odds once the live signal freshness limit (60 minutes) has elapsed. Do not weaken the freshness gate to generate more signals. A future update can expose quota visibility and an explicitly budgeted near-kickoff refresh schedule if the remaining quota allows.
