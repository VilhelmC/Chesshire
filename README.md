# Schackal

An "offbook" chess trainer: it drills the seam between the book move and what your
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

`icons` and `pwa:check` need `npm i -D playwright` first. It is deliberately not
a devDependency: both are run roughly never, and neither belongs in a fresh
install or in CI.

## Installing it on a phone

The app is a PWA. Installing requires **https or localhost** — a service worker
will not register over `http://192.168.x.x`, so on the LAN dev address there is
no install prompt and no offline mode. The app says which condition failed
rather than just hiding the button.

Pushing to `main` builds and publishes to GitHub Pages
(`.github/workflows/pages.yml`), which is https, which is what makes it
installable. One-time setup: repo **Settings → Pages → Source → GitHub Actions**.

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
