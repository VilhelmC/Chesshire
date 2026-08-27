// How many reach walks survive a move?
//
// `arrivals` runs about sixteen walks per call and `choose()` calls it once per
// option, so the same walks are recomputed twenty-odd times a ply on boards that
// differ by two squares. §7's third index row says distances should be a lookup
// with gate-based invalidation, and `paths.ts` does exactly that for POINT
// queries.
//
// Before building the walk-shaped version: how often would it hit? A walk that
// changes is a walk that has to be redone, and a cache that misses is slower than
// no cache. Measured against the truth — both walks computed and compared.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 20);
const LIMIT = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'wr-'));
const e = join(process.cwd(), '.wr-entry.ts');
writeFileSync(e, `export { reach } from './src/domain/reach';
export { complex } from './src/domain/complex';
export { options } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
const sig = (r) => [...r.dist].map(([s, k]) => `${s}:${k}`).sort().join(',');

let pairs = 0, same = 0;
const byRole = {};
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			const c = M.complex(pos, { arrivalHorizon: LIMIT });
			const before = new Map();
			for (const s of pos.board.occupied) before.set(s, sig(M.reach(pos.board, s, { limit: LIMIT })));
			for (const op of M.options(c, pos)) {
				const nx = pos.clone();
				const piece = pos.board.get(op.from);
				const promo = piece?.role === 'pawn' && (op.to >> 3 === 0 || op.to >> 3 === 7);
				try { nx.play(promo ? { from: op.from, to: op.to, promotion: 'queen' } : { from: op.from, to: op.to }); } catch { continue; }
				for (const s of nx.board.occupied) {
					const had = before.get(s);
					if (had === undefined) continue; // the mover's new square: nothing to reuse
					pairs++;
					const role = nx.board.get(s)?.role ?? '?';
					byRole[role] = byRole[role] ?? { n: 0, k: 0 };
					byRole[role].n++;
					if (sig(M.reach(nx.board, s, { limit: LIMIT })) === had) { same++; byRole[role].k++; }
				}
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${pairs} (piece, option) walk pairs at limit ${LIMIT}`);
console.log(`  walk unchanged by the move : ${same} (${((100 * same) / pairs).toFixed(1)}%)\n`);
console.log(`  by role:`);
for (const [r, v] of Object.entries(byRole).sort((a, b) => b[1].n - a[1].n))
	console.log(`    ${r.padEnd(7)} ${String(v.n).padStart(6)} pairs, ${((100 * v.k) / v.n).toFixed(1)}% unchanged`);
console.log(`\n  A cache is worth building at a high rate and worth NOT building at a low`);
console.log(`  one — a miss costs the walk plus the bookkeeping.\n`);
