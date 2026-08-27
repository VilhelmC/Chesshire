// The module, measured against the frozen baseline on the same basis. If the
// module and scripts/rank-compare.mjs disagree, one of them is wrong — which is
// the check that has actually found bugs in this project.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'rm-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { rank, best, uci } from './src/domain/rank';
export { claims } from './src/domain/cover';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
let plies = 0, right = 0, tie = 0, inTie = 0, bRight = 0, bTie = 0, t0 = Date.now();
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const want = p.moves[i].slice(0, 4);
			const { move, tied } = M.best(pos);
			if (!move) { tie++; if (tied.some((r) => M.uci(r).slice(0, 4) === want)) inTie++; }
			else if (M.uci(move).slice(0, 4) === want) right++;
			let rows = []; try { rows = M.claims(pos); } catch {}
			if (rows.length) {
				const t = Math.max(...rows.map((r) => r.value));
				const b = rows.filter((r) => r.value === t);
				if (b.length > 1) bTie++; else if (sq(b[0].move.from) + sq(b[0].move.to) === want) bRight++;
			} else bTie++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${n} (${(100 * n / plies).toFixed(1)}%)`;
console.log(`\n${P.length} puzzles · ${plies} solver plies · ${((Date.now()-t0)/plies).toFixed(0)}ms/ply\n`);
console.log(`                       outright        tie at the top`);
console.log(`  rank.ts         ${pc(right).padEnd(16)} ${pc(tie)}`);
console.log(`  frozen baseline ${pc(bRight).padEnd(16)} ${pc(bTie)}`);
console.log(`\n  answer inside a surviving tie: ${pc(inTie)}   ceiling ${((100*(right+inTie))/plies).toFixed(1)}%`);
