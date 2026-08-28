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
