## V2.6: measured calibration and timestamped public quote capture

- New `lib/calibration.mjs` fits ridge-regularized logistic corrections with **2023–2024** eligible games only; the same 2025 games are evaluated for Elo, EPA, calibrated Elo, calibrated Elo+EPA, and historical sportsbook probability. 2025 is deliberately kept out of numeric fitting, but it has been inspected during previous V2.4/2.5 research: it is not a pristine blind development holdout.
- Strict calendar-date walk-forward: score all games for a date first; add that date's results and paired weekly EPA only afterward. This is stricter than the earlier V2.5 per-game loop for avoiding concurrent-game leakage.
- Brier, log loss, five fixed probability calibration bins, training/holdout sample sizes and a rough per-game Brier-gap uncertainty interval are supplied. Do not interpret lower error as verified tradable advantage.
- Current trained Elo+EPA probability is visible only for independently verified matchups with recent paired EPA. No experimental probability affects real or paper trade qualifications, which remain sportsbook-anchored.
- An optional GitHub Actions cron job captures Kalshi public top-of-book quotes every two hours, writes daily JSONL batches, and derives a 14-day UI summary. Quotes only: **no sportsbook historical parity yet**, and no executed fills or P&L.
- Future validation needs separately archived same-timestamp bookmaker odds (with free quota controls), independently confirmed results and settlement rules, a fresh prospective untouched period, and actual fill/slippage measurements. Quarterly/season calibration should be determined only before the test period.

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


## V2.5 research design — no hindsight

The new EPA model uses public [nflverse weekly team stats](https://github.com/nflverse/nflverse-data/releases/tag/stats_team) produced via [nflfastR `calculate_stats()`](https://nflreadr.nflverse.com/articles/dictionary_team_stats.html). EPA is a context-dependent play-value statistic, not a guarantee of subsequent win probability. Our approximation uses summed team passing QB-EPA + rushing EPA over `(attempts + sacks + carries)`; it is **not** the same as reconstructing EPA per snap directly from raw PBP. Defensive estimates are opponent offense results from matched games, not a distinct official defensive EPA data series.

The 8-game recency, 0.84 decay, 5-game shrinkage constant, 3.5 logistic scale and 0.1 home logit are transparent **untuned starting parameters**. They are not claims of existing published models and must be calibrated only with training data if we add statistical fitting later.

For 2025 evaluation, chronological completed games are processed one at a time; the pregame prediction is computed before incorporating that game's statistics, scores, or bookmaker results. Elo, EPA, and 50/50 blend Brier scores are evaluated on the **same eligible game subset**, alongside nflverse pregame moneyline implied probability. Moneyline snapshot timestamps may not be verifiable, so this is **not** a confirmed closing-line value comparison. Only later truly forward-collected quotes with stored timestamps can evaluate actual Kalshi returns after fees/slippage and expected-vs-executable fills.

### Scope and next milestones

- Verify weekly team stats download and game-ID joins on the deployed instance; ensure 2026 coverage is current before interpreting EPA gaps.
- Build a timestamped persistent quote collector and scheduled snapshots to measure CLV, edge persistence, and realized returns; local browser storage is not a backtest database.
- Consider quarterback availability and injury-adjusted priors **only when a reliable historical as-of feed exists**; using later injury reports to predict earlier games would leak future information.
- Benchmark Brier/log loss and calibration over multiple seasons; compare to holdout no-vig sportsbook line, without fitting to the holdout.
- Maintain separate research comparison and fee-aware trade qualification; don't select trades solely because experimental Elo or EPA disagrees with the market.
