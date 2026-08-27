// How much of the complex actually changes when a move is made?
//
// §7 says a move is three lookups and the delta is small. `choose()` rebuilds
// everything per option regardless, and the profile says that rebuild — not the
// replay — is where the time goes. Before building the delta, check the premise:
// if most rows change anyway, there is nothing to save.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 30);
const ARR = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'ds-'));
const e = join(process.cwd(), '.ds-entry.ts');
writeFileSync(e, `export { complex, isLive } from './src/domain/complex';
export { options } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};
const key = (r) => `${r.square}|${r.from ?? '-'}|${r.via ?? '-'}|${r.kind}|${r.weight}|${r.deadline}|${r.claimant}`;

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let n = 0, kept = 0, total = 0, added = 0;
const fracs = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			const c = M.complex(pos, OPTS);
			const before = new Set(c.obligations.map(key));
			for (const op of M.options(c, pos)) {
				const nx = pos.clone();
				const piece = pos.board.get(op.from);
				const promo = piece?.role === 'pawn' && (op.to >> 3 === 0 || op.to >> 3 === 7);
				try { nx.play(promo ? { from: op.from, to: op.to, promotion: 'queen' } : { from: op.from, to: op.to }); } catch { continue; }
				const after = M.complex(nx, OPTS).obligations.map(key);
				n++;
				total += after.length;
				const same = after.filter((k) => before.has(k)).length;
				kept += same;
				added += after.length - same;
				fracs.push(after.length ? same / after.length : 1);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
fracs.sort((a, b) => a - b);
console.log(`\n${n} (position, option) pairs, arrival horizon ${ARR}`);
console.log(`  rows in the child, mean            : ${(total / n).toFixed(1)}`);
console.log(`  of those, IDENTICAL to a parent row: ${(kept / n).toFixed(1)}  (${((100 * kept) / total).toFixed(1)}%)`);
console.log(`  new or changed                     : ${(added / n).toFixed(1)}`);
console.log(`  share unchanged — median / p10     : ${(100 * fracs[fracs.length >> 1]).toFixed(0)}% / ${(100 * fracs[Math.floor(fracs.length * 0.1)]).toFixed(0)}%`);
console.log(`\n  A delta is worth building if most rows survive a move. If they do not,`);
console.log(`  §7's three lookups do not describe this ledger and the cost is inherent.\n`);
