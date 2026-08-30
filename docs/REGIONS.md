# Naming the regions

Will:

> can we make sure containers and divs are named so it's actually possible to
> refer to them

The immediate cause: neither of us could point at a part of the Lab without
describing where it sat on the screen — "the box under the board", "the panel on
the right, below the table". That is slow in conversation, ambiguous in a bug
report, and it makes browser automation guess at coordinates.

## The rule

**Every container a person might refer to carries `data-region="<name>"`.**

```tsx
<div data-region="engine-table">…</div>
<Section region="mate-proof">…</Section>
```

Names are `kebab-case`, and describe **what the thing is**, never where it sits.
`engine-table`, not `right-column-second-panel` — the layout will move and the
name should survive it.

Nested parts of one region extend its name with a hyphen, so a prefix search
finds a whole subtree:

```
explain-line
explain-line-plies
explain-line-controls
```

A component that renders a region takes a `region` prop with a sensible default,
so a second instance on the same screen can be told apart:

```tsx
<LineStepper region="explain-line" … />
<LineStepper region="mate-proof-line" … />
```

## Why `data-region` and not `id` or a class

* **`id` must be unique per document.** Two line steppers on one screen is a
  normal state, and inventing `explain-line-2` at render time gives a name that
  changes when the order does.
* **Classes are for styling**, and this project styles inline. A class used only
  as a hook drifts the moment someone assumes it does something visual.
* **`data-region` is inert.** It cannot affect layout, so it cannot be broken by
  a styling change, and it survives a refactor that swaps the element type.

## What is named

The Lab, top to bottom:

| region | what it is |
|---|---|
| `lab-controls` | motif and filter selects, the engine toggle, the graph layer |
| `lab-counts` | the archived detector's per-puzzle results, used as a filter |
| `lab-board` | the board column, including the caption under it |
| `lab-solution` | the solution's moves, as clickable plies |
| `move-list` | the played moves under the board — `train-move-list` in Train, `quiz-move-list` in Mistakes |
| `explain-numbers` | the move's own eval and the one baseline the verdict rests on |
| `line-banner` | says whose line the move list is currently showing |
| `lab-line` | a borrowed line in the Lab, whose own list belongs to the puzzle |
| `lab-ply` | the right-hand column for the ply being looked at |
| `ply-statement` | whose move it is and what was played — no judgement |
| `lab-moves` / `train-moves` / `train-moves-head` / `quiz-moves` | the shared move table — one row per move, filter chips for line / engine / played, a `?` per row |
| `training-wheels` | the overlay checkboxes and what they found |
| `mate-proof` | the ladder's surviving rung, computed on demand |
| `mate-proof-line` / `mate-proof-tree` | the walkable line, and the certificate |
| `explain-panel` | an open explanation |
| `line-player` | the line under the board, in Train and Mistakes |
| `lab-notes` | the per-ply note box |

## Checking

`test/regions.test.ts` asserts that the names in this table are the names the
components emit. A region renamed in the source and not here fails the suite —
which is the point: a naming convention nobody checks is a naming suggestion.
