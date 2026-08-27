// Does consuming the couplings change any answer?
//
// The traversal scheduled obligations as if independent. §6.1 says that is right
// wherever nothing is coupled — measured, 79.2% of plies — and wrong in the
// rest. So: on how many positions does the value actually move, and by how much?
//
// A change of nothing would mean the couplings are real and irrelevant, which is
// worth knowing before more is built on them.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ck-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { makeFen } from 'chessops/fen';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
let plies = 0, coupled = 0, moved = 0, sum = 0, biggest = 0, shown = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const c = M.complex(pos);
			const withC = M.traverse(c).value;
			// The same complex with the couplings hidden — the previous behaviour.
			const withoutC = M.traverse({ ...c, couplings: [] }).value;
			if (c.couplings.length) coupled++;
			if (withC !== withoutC) {
				moved++;
				if (shown < 4) {
					shown++;
					console.log(`  CASE ${p.id} ply ${i}  ${M.makeFen(pos.toSetup())}`);
					console.log(`     with couplings ${withC}   without ${withoutC}`);
					for (const cp of c.couplings) console.log(`     ${cp.kind}/${cp.mechanism} ` +
						(cp.kind === 'commitment' ? `${M.makeSquare(cp.piece)} holds ${cp.holds.map(M.makeSquare)} cost ${cp.cost}`
						: `${M.makeSquare(cp.from)}->${M.makeSquare(cp.to)} ${cp.was}->${cp.becomes}`));
				}
				const dv = Math.abs(withC - withoutC);
				if (Number.isFinite(dv)) { sum += dv; biggest = Math.max(biggest, dv); }
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${n} (${(100*n/plies).toFixed(1)}%)`;
console.log(`\n${P.length} puzzles · ${plies} solver plies\n`);
console.log(`  positions carrying a coupling   ${pc(coupled)}`);
console.log(`  ...where the VALUE changes      ${pc(moved)}`);
console.log(`  average change where it moves   ${moved ? (sum/moved).toFixed(0) : 0}   largest ${biggest}`);
