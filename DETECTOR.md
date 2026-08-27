# The detector

Compressing `FORMALISM.md` into something that runs, finds tactics, and says why a
move was a mistake.

The whole formalism reduces to **three functions**. Everything else — pin, fork,
overload, skewer, trapped, zugzwang — is a *label* applied afterwards to structure
that has already been computed. The labels never decide anything.

No code has been written for this yet. §8 is the build order and the test for each
stage, and none of the tests is a hand-built position.

---

## 1. The three functions

### `see(π, s, attacker) → number`

The exchange at one square, per FORMALISM §1.1–1.4: dynamic participant set
recomputed against a shrinking occupancy (so batteries and x-rays fall out),
cheapest-first, $S(j) = \max(0, c_j - S(j+1))$, king at $\infty$, absolute pins
excluded from the participant list.

Pure function of the board. Does not know whose turn it is.

### `obligations(π, c) → [Obligation]`

```
obligations(π, c):
    E = []
    for s in squares occupied by c, piece ≠ king:
        w = see(π, s, attacker = opp(c))
        if w > 0:
            E.append({ square: s, piece, w, chain: see.trace })
    if in_check(π, c):
        E.append({ square: king_square(c), piece: K, w: ∞ })
    return E
```

~16 `see` calls. This is the entire "what is at risk" layer, and note that check
enters it as an ordinary member with $w = \infty$ — no special case (FORMALISM §1.4).

### `cover(π, c) → Verdict`

The covering condition, FORMALISM §3.3. Is there **one** move that answers all of it?

```
cover(π, c):
    E = obligations(π, c)
    if E is empty: return { needed: false, concession: 0 }

    best = null; bestCost = +∞
    for m in candidates(π, c, E):
        E′   = obligations(π·m, c)
        cost = (E′ empty ? 0 : max(e.w for e in E′)) - gain(m)
        if cost < bestCost: bestCost, best, remaining = cost, m, E′

    return {
        needed:     true,
        obligations: E,
        cover:      (remaining is empty ? best : null),
        best:       best,
        concession: max(0, bestCost),
        harvest:    (remaining is empty ? null : argmax_w(remaining)),
        structure:  classify(E, candidates, ...)      // §4, naming only
    }
```

`gain(m)` is the material `m` itself wins (`see` at its destination, 0 for a quiet
move), so a defence that also takes something is priced correctly and a counter-blow
competes on the same scale as a defence. That is FORMALISM §4.2's stake criterion
falling out of the arithmetic rather than being imposed.

**Deficiency** is exactly `cover == null`. **Concession** is what it costs.

---

## 2. Candidate moves, derived

This is the only place where a wrong choice reintroduces the old failures, so it is
derived from the formalism rather than chosen.

$\mathrm{SEE}$ at a target changes only if a move changes the attacker set, the
defender set, the occupancy of a ray into it, or the piece standing on it. Enumerating
those:

```
candidates(π, c, E):
    if in_check(π, c): return legal_evasions          // §4.4: nothing outranks ∞
    T = { e.square for e in E }
    A = ⋃ attackers(π, s, opp(c))  for s ∈ T
    R = ⋃ between(a, s)            for sliding a ∈ A, s ∈ T
    B = { squares blocking one of c's OWN lines into some s ∈ T }
    W = max(e.w for e in E)

    return legal(π, c) ∩ (
          moves of the pieces standing on T          // escape
        ∪ moves capturing a square in A              // remove the attacker
        ∪ moves landing in R                         // interpose
        ∪ moves adding a defender to s ∈ T
             ONLY WHERE cheapest_attacker(s) ≥ v(piece on s)     // §1.5
        ∪ moves vacating a square in B               // discovered defence
        ∪ all checks                                 // §4.4
        ∪ { m : gain(m) > W }                        // §4.2 stake
    )
```

The §1.5 line is the largest saving and the one with a proof behind it: if the
cheapest attacker is worth less than the target, no number of defenders changes the
answer, so every "add a defender" move can be discarded without evaluating it.

Typical size 5–15 rather than ~35.

> **Soundness obligation.** The claim is that no move outside this set can cover $E$.
> That is a property to *test*, not to assume — §8.3.

---

## 3. Depth

`cover` as written is depth 1: I move, they harvest. That covers every two-prong
motif, which is nearly all of them. Beyond that the same object recurses:

```
net(π, d):                                  // material the side to move nets
    if d == 0 or candidates empty: return 0
    return max over m in candidates(π) of ( gain(m) - net(π·m, d-1) )
```

Yes — this is negamax over the candidate graph, and it is worth being blunt about
that rather than dressing it up. What sank the previous attempt was not the recursion.
It was reporting a whole-board number as a claim about one square. Here the number is
a property of the *position*, the candidate set is derived rather than hand-picked,
the leaf is 0 rather than a heuristic, and FORMALISM §4.4 gives a termination argument.
`cover` is retained as the depth-1 specialisation because it is the one whose structure
can be read out in words.

---

## 4. Naming, which decides nothing

`classify` reads the already-computed structure and attaches a word, so a human can
file it next to what they have been taught.

| label | condition on the computed structure |
|---|---|
| **fork** | $\lvert E\rvert \ge 2$, and one attacking piece appears in every obligation's attacker set |
| **double attack** | $\lvert E\rvert \ge 2$, distinct attackers |
| **overload** | one of $c$'s pieces appears in the defender set of $\ge 2$ obligations, and its removal makes both $> 0$ |
| **pin** | an obligation whose escapes all fail *because* of exposure behind — FORMALISM §2.1 with $X > 0$ |
| **skewer** | same, with $v(\text{front}) > v(\text{behind})$ |
| **trapped** | one obligation, and every escape square has $\mathrm{SEE}^{\text{safe}} > 0$ |
| **zugzwang** | $E = \varnothing$ but every legal move yields $E' \ne \varnothing$ with no cover |

Same computation, seven names. If two apply, both are true — they are not exclusive
categories, which is the point of FORMALISM §3.4.

---

## 5. Mistakes, as differences of one number

For side $c$ playing $m$ from $\pi$:

$$\mathrm{cost}(m) \;=\; \underbrace{\mathrm{hang}(\pi\cdot m,\, c)}_{\text{what they take next}} \;-\; \underbrace{\mathrm{gain}(m)}_{\text{what }m\text{ won}}$$

where $\mathrm{hang}(\psi, c) = \max\{w : (s,w) \in \mathrm{obligations}(\psi, c)\}$ — no
defence term, because after $m$ it is *their* move and $c$ does not get to defend first.

$$\Delta(m) \;=\; \mathrm{cost}(m) \;-\; \min_{m^\ast} \mathrm{cost}(m^\ast)$$

$\Delta(m) > 0$ is a tactical error of exactly that size, and it decomposes into three
independently reportable parts:

| part | formula | the sentence |
|---|---|---|
| **created** | $\max\big(0,\ \mathrm{hang}(\pi{\cdot}m, c) - \mathrm{hang}(\pi, c)\big)$ | "this move puts something at risk that was safe" |
| **unresolved** | $\min\big(\mathrm{hang}(\pi, c),\ \mathrm{hang}(\pi{\cdot}m, c)\big)$ | "something was already at risk and this does not answer it" |
| **foregone** | $\max\big(0,\ \mathrm{gain}(m^\ast) - \mathrm{gain}(m)\big)$ | "there was material on offer and this leaves it" |

Will's two failure modes are the first two columns; the third is the missed-punishment
card the trainer already wants. All three are differences of one quantity, so there is
no separate machinery per class and no threshold to tune per class.

---

## 6. Commentary, with every referent resolved

The reason the last three attempts produced vague sentences is that the computation did
not hold the nouns. This one does. Available at the point of writing:

- the obligation — **which piece, on which square, worth what**
- its full exchange chain — who takes with what, in order
- its **cheapest attacker**, which decides whether defending is even possible (§1.5)
- the covering move, if one exists, and **which mechanism** it uses (escape / capture the attacker / interpose / defend / discovered defence / bigger threat)
- if none exists, **which structure** blocks it (§4)
- for a pin: **the piece behind and its value** — this is the "what it was shielding" that had no referent before

So commentary is assembled from computed nouns, never from a template chosen by hand:

> **♗c4–b5** — the bishop lands where **♟a7** attacks it. Nothing defends b5, and a pawn
> is cheaper than a bishop, so adding a defender cannot help *(§1.5)*; the bishop has to
> move a second time. **Cost: a tempo, or the bishop.**

> **♞e4–c3+** — two obligations at once: the **♔ on e1** (infinite) and the **♕ on d1**
> (900). The check must be answered, and no legal answer also defends the queen.
> **Fork. −900.**

> **♖a1–d1** — the **♞ on d5** was already attacked and worth 320, and this does not
> answer it. The move that does is **♗c1–e3**, which defends d5 because the cheapest
> attacker there is a rook, not a pawn. **Unresolved: 320.**

Move rendering is figurine throughout and numbered when a sequence is shown, per the
Train move list.

---

## 7. What it cannot do, stated up front

Not every mistake is tactical. A move can be an error for reasons this never sees.
So the trainer's flow is **engine first, detector second**:

1. Stockfish flags the move: $\Delta\mathrm{cp}$.
2. The detector computes $\Delta(m)$ and its decomposition.
3. If $\Delta(m)$ accounts for most of $\Delta\mathrm{cp}$, the commentary is the
   decomposition. If it does not, the commentary says the engine dislikes the move for
   reasons outside the tactical account — **rather than inventing one**.

That gives a measurable quality number rather than an assertion:

> **Explanation coverage** — the fraction of engine-flagged errors in real imported
> games where $\Delta(m)$ accounts for the evaluation swing within a stated band.

Measured on actual games, reported honestly, and improvable. It is the metric that
should have existed three rounds ago.

---

## 8. Build order, and the test for each stage

Each test is differential or measured. None is a position I chose.

**8.1 `see`** — rewrite `foldAt` to FORMALISM §1.1: dynamic participants, $v(K)=\infty$
with no legality special-case, $\ge 0$ acceptance.
*Test:* differential against a brute-force minimax over all capture sequences on the
square, on random positions. These must agree exactly.

**8.2 `obligations`** — the sweep.
*Test:* every reported obligation, played out, must actually win the reported material;
every square *not* reported must not.

**8.3 `candidates` + `cover`** — the pruning and the covering condition.
*Test:* **differential against the full legal move list.** Run `cover` with the pruned
generator and with all legal moves on random positions; the concession must be
identical. This is the soundness obligation from §2 and it is the test that matters
most — it is the one that would have caught every relevance error made so far.

**8.4 `Δ(m)` and the decomposition.**
*Test:* explanation coverage against Stockfish over imported games (§7). A number, not
a claim.

**8.5 Commentary.**
*Test:* every referent resolves to a real piece and square; no bare coordinate pairs;
the sentence's numbers are read from the computation, never from a literal.

---

## 9. Validation against a puzzle database

Will's proposal, and it is better than either the hand-built fixtures or the random
generator: a puzzle has a decisive best move **by construction**, and the ground truth
is not mine.

### 9.1 The test is finding the solution, not answering yes

An earlier draft of this section led with the observation that a degenerate detector
answering *"yes, tactic"* scores 100% on an all-positive set. True, and beside the
point — because the question being asked is not "is there a tactic" but **"what is the
move".**

A puzzle has roughly 30 legal moves, so the degenerate detector scores about 3% on
solution identification. Naming the move is self-validating in a way a binary verdict
is not, and it exercises the whole chain: the obligation set has to be right, the
covering condition has to be right, and the concession arithmetic has to be right, or
the argmin lands somewhere else. That is the primary test and it needs no negative
set to mean something.

Precision is a separate question and a later one. It is not about whether the
formalism is correct; it is about whether the *trainer* is pleasant to use, since most
positions in a real game are ambient and a spurious "you missed a fork" is worse than
a miss. Measure it against quiet positions from real games — where the engine's
evaluation is stable across the move — before shipping commentary, not before
trusting the mathematics.

### 9.2 Every puzzle is two tests

The Lichess format gives a FEN plus a move list whose **first move is the opponent's**
— the blunder that creates the tactic. **Verified, not assumed:** on 1,500 uniformly
sampled rows, the first listed move belongs to the side to move in the FEN in
**1500/1500** cases, and the full line is legal in **1500/1500**. So the solver is the
side to move *after* that first move.

That yields two labelled tests per puzzle:

1. **Detection**, on the position *after* that move: `cover` must report a deficiency,
   and the puzzle's solution must be among the moves attaining the minimum cost.
2. **Explanation**, on the move *itself*: the §5 decomposition must show
   `created > 0`. This is a labelled test of the mistake commentary — the actual
   product feature — and it comes free.

### 9.3 Metrics, in order of how much they mean

Strict move equality is the wrong measure: puzzles admit transpositions and
equal-value alternatives.

| metric | what it tests |
|---|---|
| **solution ∈ argmin cost** | the whole chain at once — obligations, covering condition, concession arithmetic. **Primary.** |
| deficiency detected (`cover == null`) | §3.3 covering condition alone; weak on its own (§9.1) |
| concession ≈ material won in the solution line | magnitude, not just sign |
| `classify` label vs Lichess theme | §4 naming |
| false-positive rate on quiet game positions | product quality, not correctness (§9.1) |

The theme comparison is algorithm-vs-algorithm — Lichess themes are themselves
generated — so a disagreement is informative in both directions and is not evidence
of an error on either side.

### 9.4 Predictions, recorded before running

Written down first so they can be wrong. Per-theme recall converts *"does the
formalism work"* into a **map of its reach**, measured.

- **Expected strong**: `hangingPiece`, `fork`, `pin`, `skewer`, `trappedPiece`, `overloading`, `discoveredAttack`, `doubleCheck`.
- **Expected to work through $w = \infty$**: `mateIn1`. Mate *is* the covering condition on an obligation of infinite value with no cover — a consequence of FORMALISM §1.4, not a special case. If this fails, §1.4 is wrong.
- **Requires the depth-$d$ recursion (§3)**: `mateIn2`+, `deflection`, `attraction`, `clearance`, `sacrifice`.
- **Expected out of scope**: `endgame` technique, `advancedPawn`, positional `quietMove`, most `defensiveMove`. These should be *reported as unexplained*, not forced.
- **`zugzwang`** needs the "every legal move creates one" form in §4 and is the case most likely to expose a gap.

Stratify by rating band as well as theme. The app's users are under 1400, so recall
in the 600–1400 band is worth more than recall at 2200 — and if recall does *not*
fall off with rating, that is a reason to distrust the harness rather than to
celebrate.

### 9.5 The sample, as built

`data/puzzle_sample.csv` — **13,431 rows**, drawn from the full database (≈5M) by
uniform reservoir down to 250,000, then stratified: **45 per theme per rating band**
(bands `<1000`, `1000–1399`, `1400–1799`, `1800+`) plus **1,500 uniform** rows for the
overall rate. Each line is prefixed `THEME|BAND|` before the original CSV.

Small enough to run every build, and the general stratum is unbiased so aggregate
rates mean something.

Counts available for the themes §9.4 makes predictions about:

| theme | n | | theme | n |
|---|---:|---|---|---:|
| fork | 1311 | | mateIn1 | 2208 |
| pin | 798 | | mateIn2 | 2438 |
| hangingPiece | 458 | | mateIn3 | 1022 |
| skewer | 380 | | sacrifice | 1880 |
| trappedPiece | 235 | | advancedPawn | 1316 |
| discoveredAttack | 831 | | promotion | 687 |
| deflection | 748 | | quietMove | 667 |
| attraction | 901 | | defensiveMove | 802 |
| doubleCheck | 397 | | zugzwang | 306 |
| intermezzo | 303 | | xRayAttack | 236 |
| clearance | 335 | | interference | 207 |

Note **`overloading` is not a Lichess theme** — it returns 0. So §4's `overload` label
has no direct counterpart to compare against; `deflection` and `attraction` are the
nearest, and a mismatch there is expected rather than a defect.

### 9.6 Two gaps this exposed in FORMALISM, since repaired

Both are now **fixed** in FORMALISM §1.1a and §1.1b, and the promotion repair turned
out to cost a theorem: a promoting pawn risks $v(Q)$ while costing $v(P)$, so
cheapest-first is no longer exactly optimal and the chain must be evaluated with the
promoting pawn placed both first and last. `advancedPawn` and `promotion` puzzles are
the ones that will exercise it.

Castling needs no change to `see` — it is not a capture — but it must appear in
`candidates`, since a king move that also develops a rook can resolve an obligation.

---

### What this replaces

Retired: `knot.ts` entirely, `commit.ts`, and from `contest.ts` the whole
`arrivals` / `routeCost` / `escapesFor` / `ContestRow` / per-square-verdict apparatus —
all of it was a tempo model invented to compensate for SEE having been made to produce
a verdict instead of a filter.

Kept: the exchange fold (rewritten per 8.1), `pinnedOn`, and the parts of `reply.ts`
that enumerate legal replies.

The Lab becomes a view of `obligations` + `cover` for the position on the board —
which is a smaller and more checkable thing than the six tables it shows now.
