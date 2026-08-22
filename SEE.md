# The exchange, exactly

*Back to basics, at Will's insistence and correctly so: the extension was built
on a fold that got three things wrong. This states the base algorithm precisely,
corrects the sketch we were working from, and only then says what the extension
actually is.*

---

## 1. Will's sketch, and what it gets right

> In a normal exchange calculation, a series of opt-in min-max decisions. We
> calculate by sorting pieces that can participate in the exchange by value,
> then alternating between players. Any player can opt out if continuing the
> exchange leads to negative net value. A player wins the exchange if they come
> out net positive when the opponent opts out or doesn't have more pieces.

That is the algorithm. Four refinements, each of which is a place my code was
wrong or nearly wrong:

**Two sorted lists, not one.** Each side sorts *its own* participants cheapest
first; the two lists interleave by turn. Taking with the cheapest available
piece is not a tie-break, it is the algorithm — take a defended knight with the
rook when a pawn is available and the answer changes by four pawns.

**The opt-out is resolved backwards, not forwards.** "Stop if continuing is
negative" cannot be evaluated going forwards, because whether continuing is
negative depends on everything after it. It is one line of backward induction
from the tail:

```
S(j) = max( 0, captured(j) − S(j+1) )
```

Read: the side to move at step `j` either declines (0) or takes what is there
and concedes whatever the opponent then makes of the square. `S(0)` is the
value of the whole exchange to the side that starts it, and it is never
negative — nobody is ever forced to begin.

I got this wrong first time in a way that looked fine: I backed the min-max up
from the attacker's point of view at *every* step, which let the attacker
"stop" after capturing, and reported a free piece where the recapture wins.

**The participant list is recomputed after every capture, not fixed.** When a
piece leaves the square, whatever stood behind it on the same line joins —
doubled rooks, a queen behind a bishop. This falls out for free if you re-ask
"who bears on this square" each step instead of enumerating once, and it is
also why the queen behind a pinned knight is both the pin's target and a
defender of the contested square: one graph fact, two motif names.

**Not every piece that bears on the square can participate.** Three cases, and
two of them were silently missing from my fold until today:

- **A pinned piece is not a defender.** A pawn pinned to its own king cannot
  recapture, and the count reported a defended piece where the piece was free.
  It *can* still capture along the pin — including the pinner itself — so the
  test is not "is it pinned" but "is the contested square on its pin ray".
- **The king can only take last.** It may capture only if nothing enemy remains
  bearing on the square. Pricing the king absurdly high does this correctly as
  arithmetic: any line where it recaptures into an attack scores as
  catastrophic, so the fold declines it.
- **A pawn capturing onto the last rank arrives as a queen.** It wins what it
  took *and* the difference in its own value, and the piece the opponent must
  now deal with is a queen. Missing this priced a promoting capture eight pawns
  short.

## 2. What "wins the exchange" means

The final refinement to the sketch is about the word *wins*. `S(0) > 0` does not
mean "I come out ahead"; it means **taking is better than not taking**. In a
position where I am losing a piece anyway, an exchange with `S(0) = 0` may still
be the right move for other reasons — the fold is a comparison between two
options at one square, not a verdict on the position.

This matters for the app because it is the honest limit of the whole approach:
the fold answers *"what does this square cost"*, and nothing else.

## 3. Tempo is assumed constant, and that assumption is the whole extension

Will's observation, which is the sharpest thing said about this so far:

> Notice the tempo in the conventional calculation is implicitly assumed to be
> constant — we just alternate, but there are no intermediate threats or checks
> (compulsion) that interfere.

Exactly. Standard SEE is a strict alternation with no option to do something
else, and that is what makes it computable without search. Everything the
extension wants to say lives in relaxing that assumption, and the honest way to
relax it is to say *how* it can be violated rather than to search.

## 4. The extension, restated — and it is not a race

I built the extension as a small alternating search. Will's correction:

> Doing the exchange calculation beforehand is the same logic. Not really a
> race. We simply look at the graph of possible moves and pieces that are one
> move away from being included in the exchange sort chain. So it's just
> potential pieces to commit to the SEE algorithm.

He is right, and the search was over-reach. The correct structure is the same
fold with a larger participant list:

```
participants(k) = pieces bearing on the square now
                + pieces that can bear on it within k moves, both sides
```

and then the same backward induction over that list. Tempo enters as the index
`k`, symmetrically: at `k = 1` both sides have everything one move away.

**And the constant-tempo assumption is inherited, so it has to be stated rather
than searched.** A knot counted at `k` fails to form for exactly three reasons,
and each is a checkable list rather than a number:

1. **The target leaves.** It has the same tempo the attacker is spending.
2. **A defender arrives faster than the attacker.** Already handled: it is in
   `participants(k)` too.
3. **Someone interposes a forcing move.** A check, or a threat larger than the
   knot, spends the opponent's tempo for them. This is the case that broke the
   count, and it is compulsion — the thing standard SEE assumes away.

So the output should be: **the fold at each `k`, plus the enumerated ways it
fails** — not one number produced by a search that hides which of the three
happened. That is both more honest and more teachable, because those three are
exactly what a human should check.

## 5. Status

- §1's four refinements: **implemented and tested** (`domain/contest.ts`,
  `test/contest.test.ts` — "the fold, at its edges").
- §4's restructuring: **not yet done.** The verdict currently comes from
  `domain/race.ts`, the alternating search, which gets the adjudicated fixtures
  right but answers by searching rather than by counting-and-listing. Replacing
  it with `participants(k)` + the three spoiler lists is the next change, and it
  should make the answer smaller, faster and easier to check.
