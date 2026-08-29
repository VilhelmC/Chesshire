# attic — retired code, kept

Nothing in this project is deleted. Code that leaves the build moves here.

That includes mechanisms retired under **rule 9** — *"a mechanism that is
theoretically right and measures worse is still deleted, and the reasoning is
kept in the file where the next person will look for it."* Withdrawn from the
build; not removed from the repo. We are still experimenting and may want to go
back.

See `offbook/AMEND-ARCHIVE-NOT-DELETE.md` for the rule, and
`offbook/PLAN-PNS-LADDER.md` for what is scheduled to arrive here.

## How this is kept out of the way

* **Typecheck** — `tsconfig.json` includes exactly `["src", "test",
  "vite.config.ts"]`, so `attic/` is already outside it. Archived modules do not
  have to compile and their imports may dangle.
* **Tests** — `vite.config.ts` carries `test.exclude` with `attic/**`. Vitest
  reads that file rather than a config of its own, so the suite keeps the react
  plugin while skipping everything here.
* **History** — everything moved with `git mv`, so `git log --follow` still
  works on an archived file.

## Restoring

Move it back and re-add whatever imported it:

```
git mv attic/<stack>/<file>.ts src/domain/<file>.ts
```

Tests come back the same way, from `attic/<stack>/*.test.ts` to `test/`.
Probe scripts from `attic/<stack>/scripts/` to `scripts/`.

---

## ledger2 — the second-generation covering stack

**Archived:** 2026-08-28, ahead of the ladder work.

**What it was.** `concede2.ts` implemented §4's concession recurrence —
`L(E) = min_R max_{e in E\R} (w_e + L(E\R\{e}))` — with `unroll`, `plays`,
`concedes`, `ladder`, `reckon` and `say`. It was the first correct
implementation of the recurrence in the project.

**Why it is here.** It went unused. `traverse.ts` says so in its own comment:
*"`concede2.ts` has implemented the recurrence since M6 without the traversal
ever calling it."* The traversal grew its own copy, and this one was left
reachable only from its test and four probe scripts — nothing on the live UI
path.

**Which doc explains the decision.** `offbook/PLAN-PNS-LADDER.md` §3, which
schedules the whole ledger2 stack for the attic once `pns.ts` + `ladder.ts`
replace it. This module went first because it is the only piece separable
today: `ledger2.ts` and `cover2.ts` still feed `graphShapes.ts`, which the Lab's
board overlay uses.

**What moved with it.** Its test (24 cases) and the four probes that import it:
`mate-probe`, `rank-compare`, `tie-why`, `unroll-probe`.

**What did not need changing.** `test/no-search.test.ts` names `concede2.ts` in
its GUARDED list but filters that list through `existsSync`, so it skips the
file rather than failing on it. A guard that degrades gracefully when its
subject is archived — worth copying.

**Restore:**

```
git mv attic/ledger2/concede2.ts       src/domain/concede2.ts
git mv attic/ledger2/concede2.test.ts  test/concede2.test.ts
git mv attic/ledger2/scripts/*.mjs     scripts/
```

---

## depth-search — stack 1, the original detector

**Archived:** 2026-08-29, M6.

**What it was.** The Lab's first analysis layer, and for months the only one.
`resolve.ts` scored every legal move by a depth-4 search with a node budget;
`chain.ts` built the branch tree behind one move; `narrate.ts` turned that tree
into English; `ledger.ts` and `cover.ts` were the obligation model it evaluated
against; `mate.ts`, `race.ts` and `invade.ts` were its special-case rungs.
`LedgerPanel.tsx` displayed the whole thing.

**Why it is here.** It was superseded twice. `pns.ts` + `ladder.ts` replaced its
search with a proof, and then the explainer replaced the ladder's *pedagogy*
with Stockfish as the oracle. By M6 it was reachable only behind the "old depth
search" checkbox, and its verdict box was still narrating itself — *"the
detector values it at …"* — about an evaluator nothing else in the app consulted.

**Which doc explains the decision.** `offbook/PLAN-PNS-LADDER.md` §3 and §5 (read
with "Delete" replaced by "Move to attic/", per `AMEND-ARCHIVE-NOT-DELETE.md`),
and `offbook/PLAN-EXPLAINER.md` §0 for why the oracle is the engine rather than
anything in this stack.

**What moved with it.** Its four tests, and `lab-detector.test.ts` — the file
that was `test/lab.test.ts`, whose argument is worth keeping verbatim: the first
version of the Lab said "Found it" whenever the puzzle's answer was among the
top-scoring moves, which on a quiet position where eleven moves all score zero
is true and worthless. The three-way found/tied/missed verdict existed to stop
that lie. `test/lab.test.ts` survives with the `chainOf` cases only, which never
depended on which detector was running.

**What changed in the Lab when it went.** The ranking table it lived in was also
where the Stockfish comparison column was rendered, so that table was rebuilt as
`EngineTable` — Stockfish alone, rows clickable into the explainer. And the
default board arrows lost the detector's own pick. Will, asked whether the
ladder should inherit that slot: *"Why would we show the ladder's move when the
ladder is wrong and superseded? Lab default should show only the played move."*

**Restore:**

```
git mv attic/depth-search/resolve.ts      src/domain/resolve.ts
git mv attic/depth-search/chain.ts        src/domain/chain.ts
git mv attic/depth-search/narrate.ts      src/domain/narrate.ts
git mv attic/depth-search/ledger.ts       src/domain/ledger.ts
git mv attic/depth-search/cover.ts        src/domain/cover.ts
git mv attic/depth-search/mate.ts         src/domain/mate.ts
git mv attic/depth-search/race.ts         src/domain/race.ts
git mv attic/depth-search/invade.ts       src/domain/invade.ts
git mv attic/depth-search/LedgerPanel.tsx src/components/LedgerPanel.tsx
git mv attic/depth-search/*.test.ts       test/
```

---

## ledger2 — the second-generation covering stack (the rest of it)

**Archived:** 2026-08-29, M6. `concede2.ts` went a day earlier; see above.

**What it was.** `ledger2.ts` and `cover2.ts` were the obligation model and Γ —
every obligation joined to the moves that discharge it. `couple.ts` found the
places two exchanges are not independent: a defender holding two squares, a
contested square, an x-ray, a parity.

**Why it is here.** The ladder replaced the covering model, and the primitives
replaced the couplings. `couple.ts` is worth a note: its `contestedDefender`
comment was the warning that saved M5 a wasted week —

> *"tested as a mechanism it fires on nearly every position"*

— and the overload detector built on that warning still failed its gate
(`offbook/FINDING-OVERLOAD-DOES-NOT-SHIP.md`). The mechanism is real; nothing
measured has yet detected it.

**Which doc explains the decision.** `offbook/PLAN-PNS-LADDER.md` §3, and
`offbook/FINDING-OVERLOAD-DOES-NOT-SHIP.md` for the coupling half.

**What moved with it.** Three tests, and three layers of the board overlay.
`graphShapes.ts` stays — it is re-pointed rather than rewritten, as
`AMEND-ARCHIVE-NOT-DELETE.md` says — but its `owed`, `cover` and `couplings`
layers came out with their imports, along with `explainCover`,
`explainCouplings`, `badge`, `COVER` and `couplingsAt`. The layers that remain
(`attacks`, `latent`, `sensitive`, `motifs`, `reach`) depend only on `graph.ts`,
`reach.ts` and `exchange.ts`, none of which is archived.

**Restore:**

```
git mv attic/ledger2/ledger2.ts      src/domain/ledger2.ts
git mv attic/ledger2/cover2.ts       src/domain/cover2.ts
git mv attic/ledger2/couple.ts       src/domain/couple.ts
git mv attic/ledger2/*.test.ts       test/
```

The three overlay layers would have to be rebuilt in `graphShapes.ts`; the
commit that removed them is the diff to read.

---

## complex — stack 3, the priced option set

**Archived:** 2026-08-29, M6.

**What it was.** `complex.ts` priced every legal move against an obligation
model; `choose.ts` ranked them; `traverse.ts` was the scheduling traversal that
grew its own copy of the concession recurrence; `gamma.ts` was Γ before
`cover2.ts`. `ComplexPanel.tsx` showed thirty moves each with a number.

**Why it is here.** `LadderPanel.tsx`'s own header says it: *"`ComplexPanel`
showed a priced option set: thirty moves, each with a number."* A ranked list of
numbers is not a proof and cannot be checked, which is the argument the ladder
was built on. Its ray and coupling logic was extracted before it went — the
`Shape` type in `Board.tsx` and the filled-glyph `Man` in `MaterialBar.tsx` both
came from this panel and are still in use.

**Which doc explains the decision.** `offbook/THEORY-ORDERED-LADDER.md` for why a
proof by exclusion beats a priced list, and `offbook/PLAN-PNS-LADDER.md` §5.

**What moved with it.** Three tests.

**Restore:**

```
git mv attic/complex/complex.ts       src/domain/complex.ts
git mv attic/complex/choose.ts        src/domain/choose.ts
git mv attic/complex/traverse.ts      src/domain/traverse.ts
git mv attic/complex/gamma.ts         src/domain/gamma.ts
git mv attic/complex/ComplexPanel.tsx src/components/ComplexPanel.tsx
git mv attic/complex/*.test.ts        test/
```
