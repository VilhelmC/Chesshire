// Regenerate `src/data/ledgerBuckets.json` — which plies the stack fails, and how.
//
// ---------------------------------------------------------------------------
// The Lab filters puzzles by this file, and the file on disk was generated
// against `ledger.ts` at τ = 1 — M1, which M7 deletes. So the "wrong preference"
// filter has been selecting for a system nobody is working on.
//
// Four buckets, and the distinction between the first two is the whole diagnosis:
//
//   blind      the answer is not in the option set. No pricing can reach it;
//              this is Γ or the candidate rule, not the traversal.
//   tied       the answer is at the top and so is something else. Will: "no moves
//              can be tied, other than equivalent non-zero scores" — so a tie is
//              a statement that the complex is too coarse.
//   wrong      the answer was named and something else was paid more. Pricing.
//   found      not written to the file; a ply the stack gets outright is not a
//              case to review.
//
// Plus a suffix `:mateK` when the puzzle is a mate and K of the solver's own
// moves remain. `FINDING-MATE-IN-K.md`: mate-in-1 is 86.5% and mate-in-2 is
// 30.9%, so being able to select that class in the Lab is the point of this run.
// ---------------------------------------------------------------------------
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 1031);
const ARR = Number(process.argv[3] ?? 3);
const OUT = 'src/data/ledgerBuckets.json';

const d = mkdtempSync(join(tmpdir(), 'lb-'));
const e = join(process.cwd(), '.lb-entry.ts');
writeFileSync(e, `export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const OPTS = { ...(ARR ? { arrivalHorizon: ARR } : {}) };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const mateDepth = (p, i) =>
	p.themes.some((t) => t.startsWith('mateIn') || t === 'mate') ? Math.ceil((p.moves.length - i) / 2) : 0;

const out = {};
const tally = { found: 0, blind: 0, tied: 0, wrong: 0 };
const t0 = Date.now();
let done = 0;

for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			let best, all;
			try { ({ best, all } = M.choose(pos, OPTS)); } catch { continue; }
			const offered = all.some((x) => x.from === want.from && x.to === want.to);
			const hit = best.some((x) => x.from === want.from && x.to === want.to);
			const bucket = !offered ? 'blind' : !hit ? 'wrong' : best.length > 1 ? 'tied' : 'found';
			tally[bucket]++;
			if (bucket !== 'found') {
				const k = mateDepth(p, i);
				(out[p.id] ??= {})[i] = k ? `${bucket}:mate${k}` : bucket;
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
	if (++done % 50 === 0) process.stderr.write(`  ${done}/${P.length} puzzles, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}

writeFileSync(OUT, JSON.stringify(out));
const n = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`\n${n} solver plies over ${P.length} puzzles, arrival horizon ${ARR}`);
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(8)} ${String(v).padStart(5)}  ${((100 * v) / n).toFixed(1)}%`);
console.log(`\nwrote ${OUT} — ${Object.keys(out).length} puzzles with at least one failing ply\n`);
