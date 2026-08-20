# Progress metrics — what others track, and what we honestly can

Research note, August 2026. Written to decide what Chesshire should measure, not to catalogue the field.

---

## 1. The finding that matters most

**No chess training product measures whether training transfers into real games.**

That was checked across Chessable, Chessbook, Aimchess, Chess Position Trainer, Listudy, Chess Tempo and DecodeChess. Every metric any of them shows is one of three kinds:

- **Effort inside the app** — Chessable's XP, levels, streaks, "moves learned"; Listudy's Leitner values.
- **A static property of the repertoire artifact** — Chessbook's effectiveness, soundness, learnability. Real-game data, but *other people's* games at your rating, scoring the repertoire's expected value rather than your results.
- **A cross-sectional diagnostic of current play** — Aimchess's six skill dimensions, computed from your imported games. Genuinely your games, but a snapshot: nothing attributes a change to training you did.

Three near-misses are worth understanding precisely, because each is easy to mistake for transfer:

1. **Chessbook reviews your online games** against your repertoire and quizzes you on the deviations. This closes the loop from real play back to training — the closest anyone gets — but it measures *adherence* ("did you play your prep?"), not a performance delta.
2. **Chessbook effectiveness** uses real-game results, but from strangers, with no time dimension.
3. **Aimchess** takes real games as input, so its numbers are real-game numbers. Whether it trends them over time is undocumented; nothing claims a causal link to training completed.

The gap looks structural rather than accidental. Chessable markets XP explicitly as a substitute for rating *because* rating moves slowly and noisily — and a reviewer studying for 30 days found dashboard metrics climbing while rating barely moved. Measuring transfer honestly needs a longitudinal design these products have chosen not to build.

**Chesshire already has it** (`src/domain/transfer.ts`). The design consequence: everything else proposed below is a supporting number, and none of it should be allowed to crowd out the one metric nobody else has.

---

## 2. Accuracy: one method is fully published, the other is not

### Lichess — open, exact, citable

Every constant is in the source. Verified against `lichess-org/lila` and `lichess-org/scalachess` rather than the documentation page, because **the two disagree**.

**Centipawns → win percentage** (`scalachess`, `core/src/main/scala/eval.scala`):

```
Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
```

with details that are easy to miss and change the answer:

- `cp` is **clamped to ±1000** before the logistic, so Win% tops out at 97.54.
- **Any mate is ±1000cp.** Mate-in-1 and mate-in-20 are identical.
- **The initial position is +15cp, not 0** — every accuracy chain starts at Win% 51.38.
- The multiplier was fitted by curve-fit over ~75,000 positions from 2300+ rated rapid games (June 2022 database). It is calibrated on *strong* players' rapid games, not on a 1400 band.

**Win% → per-move accuracy** (`lila`, `modules/analyse/src/main/AccuracyPercent.scala`):

```
if after >= before: 100
else: 103.1668100711649 * exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1
     clamped to [0, 100]
```

That trailing **`+1` is an "uncertainty bonus" present in the code and absent from the published page**. It means a swing must exceed ~0.66 Win% points before accuracy drops below 100 at all. The constants are also published rounded. *Trust the code.*

The curve itself was fitted to hand-chosen anchor points — a designer's judgement about what a given swing should be worth — not to empirical data. Worth knowing before treating the number as objective.

**Combining per-move into per-game** — the part usually got wrong. It is *the arithmetic mean of two different means*:

1. Window size = `clamp(moves / 10, 2, 8)`; sliding windows over the Win% series, front-padded so early moves are weighted.
2. Each window's weight = `clamp(populationStdDev(win% in window), 0.5, 12)`. Volatile phases get up to 24× the weight of quiet ones.
3. `weighted = Σ(acc·w) / Σw`, and `harmonic = n / Σ(1 / max(1, acc))`.
4. **Game accuracy = (weighted + harmonic) / 2.**

The harmonic component is what makes a single blunder hurt disproportionately. Phase accuracies rerun the identical function over opening/middlegame/endgame slices.

### Chess.com — proprietary, do not imitate

CAPS2 is unpublished. The help centre says only that moves are "compared against the top engine recommendations" and that scores were rescaled to "replicate the feeling of being graded on a test in school," typically landing between 50 and 95. The original CAPS article lists conceptual inputs and concedes some things are "not easily measurable in this formula."

**Any "Chess.com accuracy formula" online is community reverse-engineering.** If we show an accuracy number it should be Lichess's method, named as such, or our own under a different name — never a number implying comparability with Chess.com's.

Their **Estimated Elo** is the most-complained-about number on the platform precisely because its inputs are undocumented. If we ever show a per-game strength estimate, publishing the method is the differentiator.

### ACPL — convention, with known flaws

Lichess's implementation (`AccuracyCP.scala`) is:

```
ACPL = round( mean over your moves of max(0, clamp(cp_after, ±1000) − clamp(cp_before, ±1000)) )
```

Four flaws, all relevant to us:

- **Lopsided positions are not handled.** +900 → +600 counts as a 300cp loss identically to +150 → −150, though the first changes nothing. This is exactly why Lichess moved to Win%-based judgement.
- **Forced moves are not handled.** A long forced sequence contributes a run of zero-loss moves, deflating ACPL and inflating accuracy. There is an open Lichess issue proposing candidate-count normalisation; it is unimplemented.
- **Mate collapses to ±1000.** Converting +1000 into mate-in-3 registers zero loss; throwing away a forced mate for a merely-winning position also registers zero.
- **Arithmetic mean, no variance term** — far more forgiving of one catastrophe than accuracy's harmonic component. Showing both is not redundant.

---

## 3. A finding about our own code

**`MISTAKE_CP = 150` is the model Lichess abandoned.**

`src/engine/analyseGame.ts` flags a move as a mistake when it costs 150 centipawns. Lichess's thresholds are win-percentage drops — inaccuracy ≥ 10%, mistake ≥ 20%, blunder ≥ 30% — and the switch was made for exactly the reason above: in a decided position a large centipawn swing means nothing, and near equality a small one means a great deal.

We partly compensate with `DECIDED_CP = 800`, which skips positions already lopsided. That is a blunt version of the same idea and it is better than nothing. Having the exact conversion available makes the principled version cheap: convert both evaluations to Win% and threshold on the drop.

The effect on the deck would be real — fewer cards from positions that were already won or lost, more from moves that actually changed the game. That is a better deck by the app's own thesis.

---

## 4. What we can honestly compute

The discipline established in §M9 and §M11 applies: **a number derived from incomplete data is not a smaller number, it is a different claim.**

| Metric | Status | Why |
|---|---|---|
| Free-play accuracy | **Now** | Those answers already store `cpLoss` per move, measured identically. |
| Game accuracy, Lichess-analysed games | **One field away** | `ImportedGame.evals` already arrives with per-ply site evaluations — and `ImportedGameRow` throws them away at storage. Keep them and accuracy is exactly computable, retroactively for anything re-imported. |
| Game accuracy, other games | **One field away** | `findMistakes` already evaluates every one of our positions during import and discards the per-move numbers. Store them. |
| ACPL | Same as above | Falls out of the same stored evals. |
| Phase accuracy (opening/middle/end) | Same as above | Same data, sliced. Phase boundaries need defining. |
| Blunder / mistake / inaccuracy counts | Same as above | Should use Win% thresholds, not centipawns — see §3. |
| Repertoire coverage ("what fraction of games you'd meet are covered") | **Feasible** | The explorer already returns move frequencies; this is Chessbook's best idea and it fits our tree. |
| Opponent-deviation depth ("how many moves before they leave book") | **Feasible** | Already effectively computed during a run. |
| Estimated Elo per game | **Avoid** | Requires calibration we do not have. Chess.com's is a black box and widely distrusted. |

The rule for everything in rows 2–6: games imported *before* the change have no stored evals and must show as **not measured**, exactly as the move-less games already do. Re-import recovers them.

---

## 5. Recommendation

1. **Store the evaluations at import.** One field on `ImportedGameRow`. Cheap, unlocks rows 2–6, and is the only step that is time-gated — every game imported without it is a game that has to be re-analysed later.
2. **Implement Lichess's accuracy exactly**, constants and `+1` and the two-means combination, and say in the UI that it is Lichess's method. It is published, checkable, and gives a number directly comparable with what the same game shows on Lichess — which is a stronger claim than an in-house formula.
3. **Switch mistake detection to Win% thresholds.** Better cards, and it removes a known flaw rather than adding a feature.
4. **Then** consider coverage and deviation depth, which are the two metrics that suit this app specifically.
5. **Keep transfer at the top of Progress.** It is the only thing here nobody else has, and it is the one most easily buried under a row of familiar numbers that are easier to compute and less informative.

---

## Sources

**Formulas and code**
[AccuracyPercent.scala](https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala) ·
[AccuracyCP.scala](https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyCP.scala) ·
[Advice.scala](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala) ·
[scalachess eval.scala](https://github.com/lichess-org/scalachess) ·
[lila PR #11148 (win% fit)](https://github.com/lichess-org/lila/pull/11148) ·
[lila issue #11737 (forced-move normalisation)](https://github.com/lichess-org/lila/issues/11737) ·
[Lichess accuracy page](https://lichess.org/page/accuracy)

**Chess.com**
[How is accuracy determined](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined) ·
[CAPS announcement](https://www.chess.com/article/view/better-than-ratings-chess-com-s-new-caps-system) ·
[Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work) ·
[Insights](https://support.chess.com/en/articles/8708925-what-is-insights-on-chess-com) ·
[Puzzle rating change, Oct 2025](https://support.chess.com/en/articles/12488563-why-did-my-puzzle-rating-change)

**Lichess features**
[Insights blog](https://lichess.org/blog/VmZbaigAABACtXQC/chess-insights) ·
[Rating systems](https://lichess.org/page/rating-systems) ·
[FAQ](https://lichess.org/faq)

**Trainers**
[Chessbook wiki: repertoire statistics](https://publish.obsidian.md/chessbookwiki/Repertoire+statistics) ·
[Effectiveness](https://publish.obsidian.md/chessbookwiki/Effectiveness) ·
[Soundness](https://publish.obsidian.md/chessbookwiki/Soundness) ·
[Learnability](https://publish.obsidian.md/chessbookwiki/Learnability) ·
[Mastery](https://publish.obsidian.md/chessbookwiki/Mastery) ·
[Chessable SRS scheduling](https://support.chessable.com/en/articles/9043598-how-does-the-spaced-repetition-scheduling-work) ·
[Chessable learning status](https://support.chessable.com/en/articles/9044158-how-is-the-learning-status-calculated) ·
[Aimchess](https://aimchess.com/) ·
[Chess Position Trainer](http://www.chesspositiontrainer.com/index.php/en/features/79-features/81-repertoire-knowledge) ·
[Listudy](https://listudy.org/en/blog/spaced-repetition-for-chess)

**Unverified, flagged as such:** Chessable's accuracy formula and streak mechanics; Aimchess's scoring formulas and whether it trends over time; Chess Tempo's displayed statistics; whether Chess.com Insights exposes centipawn-loss buckets or per-move time as first-class dimensions; whether ECO code is a selectable Lichess Insights dimension.
