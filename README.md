# Chesshire

An "offbook" chess trainer — a Cheshire grin whose teeth are chessboard squares: it drills the seam between the book move and what your
opponent actually plays. See [`SPEC.md`](./SPEC.md) for the full design.

## Setup

```bash
npm install     # also copies the Stockfish WASM engine into public/engine/
npm run dev     # http://localhost:5173
```

`npm install` pulls the `stockfish` package (~240 MB in `node_modules`) but only
copies the two files we ship (~7 MB) into `public/engine/`, which is gitignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run openings` | Regenerate the bundled opening index |
| `npm run icons` | Regenerate the app icons from one inline SVG |
| `npm run pwa:check` | Build, then verify the manifest, the service worker **and an offline boot** |
| `npm run shots` | Screenshot every tab, light and dark, phone and desktop, into `.shots/` |
| `npm run deploy` | Build and publish to the `gh-pages` branch |

`icons` and `pwa:check` need `npm i -D playwright` first. It is deliberately not
a devDependency: both are run roughly never, and neither belongs in a fresh
install or in CI.

## Installing it on a phone

The app is a PWA. Installing requires **https or localhost** — a service worker
will not register over `http://192.168.x.x`, so on the LAN dev address there is
no install prompt and no offline mode. The app says which condition failed
rather than just hiding the button.

`npm run deploy` builds and pushes to the `gh-pages` branch, which GitHub serves
over https at `https://vilhelmc.github.io/Chesshire/` — and https is the whole
point, because it is what makes the app installable.

One-time setup: **Settings → Pages → Source → Deploy from a branch → `gh-pages`
/ `(root)`**.

The deploy writes the branch through a git *worktree* rather than checking it
out, so your working tree never moves to a branch containing nothing but build
output. It refuses to push when the build is byte-identical to what is already
live, and it says so out loud when it is publishing uncommitted changes.

`.github/workflows/pages.yml` does the same thing on a runner and is kept, but
**dormant** — its `push` trigger is commented out, because Actions minutes are
metered and this is not. Re-enabling it is one uncomment plus switching the
Pages source back.

Offline is partial and honest about it: Train needs the Lichess explorer and
cloud eval, so with the network off you get the Mistakes deck, Progress, Review,
and any position already cached.

## Current state — M0

The landing page is a dependency harness, not the product. It verifies the three
external things the whole pipeline rests on:

1. **Board + chessops** — plays the Italian and checks the resulting FEN.
2. **Stockfish WASM** — runs a depth-16 MultiPV-3 analysis in a Worker.
3. **Lichess explorer** — fetches Black's replies at the 1000–1400 band and
   renders the raw response.

Check (3) first. Neither the build sandbox nor the device VM can reach
`lichess.org`, so the explorer client's parameter names are written from the
public docs and **verified for the first time in your browser**. If the smoke
test fails, the fix is in `src/data/explorer.ts` and `src/domain/types.ts`.

## Layout

```
src/
	config.ts          # resolved settings — usernames, rating bands, speeds
	domain/            # types, thresholds, chess helpers (pure, tested)
	data/              # IndexedDB, Lichess explorer, cloud eval
	engine/            # Stockfish worker wrapper
	components/        # Board
	views/             # Build (M0 harness)
```

## Design notes worth not undoing

- **No COOP/COEP headers.** We use the single-threaded Stockfish build so we
  don't need `SharedArrayBuffer`. Turning on `require-corp` would break the
  cross-origin fetches to Lichess. See SPEC.md §8.
- **Explorer calls are throttled to 1 req/s and cached forever.** It is free
  community infrastructure.
- **Truncation is never silent.** `truncateByCoverage` returns what it dropped
  so the coverage audit can report it. A trainer that hides its gaps is worse
  than no trainer.

## Licence

**GPL-3.0-or-later.** Full text in [`LICENSE`](./LICENSE).

    Chesshire — an offbook chess trainer
    Copyright (C) 2026 Will (@VilhelmC)

    This program is free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by the Free
    Software Foundation, either version 3 of the License, or (at your option)
    any later version.

    This program is distributed in the hope that it will be useful, but
    WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
    Public License for more details.

    You should have received a copy of the GNU General Public License along
    with this program. If not, see <https://www.gnu.org/licenses/>.

Not a free choice: `chessground`, `chessops` and `stockfish` are all GPL and all
shipped to the browser, so the combined work has to be GPL-compatible. See
SPEC.md §12 for the reasoning, including why AGPL was considered and deferred.

### Third-party components

| Component | Licence |
|---|---|
| [chessground](https://github.com/lichess-org/chessground) | GPL-3.0-or-later |
| [chessops](https://github.com/niklasf/chessops) | GPL-3.0-or-later |
| [Stockfish](https://github.com/official-stockfish/Stockfish) | GPL-3.0-or-later |
| [Dexie](https://dexie.org/) | Apache-2.0 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT |
| [React](https://react.dev/) | MIT |
| [Source Sans 3](https://github.com/adobe-fonts/source-sans) (bundled, self-hosted) | SIL Open Font Licence 1.1 |
| Opening names from [chess-eco-codes](https://github.com/hayatbiralem/eco.json) | MIT |

The app icon (`assets/chesshire.svg`) was drawn for this project and is covered
by the same GPL-3.0-or-later licence as the rest of it. `npm run icons`
regenerates the PNGs from it; the source lives in `assets/`, not `dist/`, which
`vite build` empties on every run.

Opening statistics come from the [Lichess opening explorer](https://lichess.org/api)
and evaluations from [Lichess cloud eval](https://lichess.org/api), both used
under the Lichess API terms. No game data leaves your browser except the
positions sent to those two endpoints.
