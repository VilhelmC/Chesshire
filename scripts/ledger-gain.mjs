// Does the new ledger see what the old one called "nothing happening"?
//
// LEDGER-M1.md measured a "blind" bucket of 576 solver plies (21.7%) where every
// legal move scored zero because no obligation existed at all. Theme lift said
// advancedPawn x2.8, promotion x2.6. This asks the narrow question directly:
// on the plies where the OLD ledger was empty, is the NEW one?
//
// Not a solve rate. The covering condition is M4, so nothing here claims the
// puzzles are solved — only that the state is no longer blank.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'lg-'));
const e = join(d, 'e.ts');
writeFileSync(e, `export { ledger as fresh, isLive } from ${JSON.stringify(join(process.cwd(),'src/domain/ledger2.ts'))};
export { ledger as stale } from ${JSON.stringify(join(process.cwd(),'src/domain/ledger.ts'))};
export { positionFromFen, parseSquare } from ${JSON.stringify(join(process.cwd(),'src/domain/chess.ts'))};`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
  const mv = { from: M.parseSquare(u.slice(0,2)), to: M.parseSquare(u.slice(2,4)) }; if (pr) mv.promotion = pr; n.play(mv); return n; };

const ALL = JSON.parse(readFileSync('src/data/labPuzzles.json','utf8')).slice(0, N);
let plies = 0, wasBlank = 0, nowSeen = 0, latentOnly = 0, deferred = 0, themes = {};
let t0 = Date.now();
for (const p of ALL) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			// What the side to move can win — the attacker's view.
			const them = pos.turn === 'white' ? 'black' : 'white';
			const before = M.stale(pos, them);
			const after = M.fresh(pos, them);
			if (!before.length) {
				wasBlank++;
				// A latent obligation is a square to watch, not a debt owed now.
				// AMEND-1 made those recordable, so the honest headline counts
				// only the live rows; latent-only is reported beside it.
				//
				// Asked of the module, not reimplemented here. This harness inlined
				// `!x.needs.length && !x.enablers.length`, which was the liveness test
				// at the time — and when AMEND-1B made `needs` the route rather than
				// the obstruction list, the inlined copy silently reported 0.7%.
				// Rule 5: the instrument gets the same treatment as the code.
				const live = after.filter((x) => M.isLive(x, pos.board));
				if (live.length) {
					nowSeen++;
					for (const t of p.themes) themes[t] = (themes[t] ?? 0) + 1;
				} else if (after.length) {
					latentOnly++;
				}
			}
			if (after.some((x) => x.deadline > 1)) deferred++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${ALL.length} puzzles · ${plies} solver plies · ${((Date.now()-t0)/plies).toFixed(0)}ms/ply\n`);
console.log(`plies where the OLD ledger was empty : ${wasBlank}`);
console.log(`  ...where the NEW one is not       : ${nowSeen}  (${(100*nowSeen/Math.max(1,wasBlank)).toFixed(1)}%)`);
console.log(`  ...where the NEW one has only latent rows: ${latentOnly}  (${(100*latentOnly/Math.max(1,wasBlank)).toFixed(1)}%)`);
console.log(`plies carrying at least one deferred obligation: ${deferred} (${(100*deferred/plies).toFixed(1)}%)`);
console.log(`\nthemes of the newly-seen plies:`);
for (const [k,v] of Object.entries(themes).sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`  ${String(v).padStart(4)}  ${k}`);
