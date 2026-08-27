// What does the traversal cost, and where does it stop being affordable?
//
// §4's alternation memoises on (mask, round), so it is exponential in the number
// of live rows ON ONE SIDE. `MAX_ROWS` is 16, which is 65,536 masks — fine when
// the corpus produces at most 6 rows a side, and not fine at all once arrival
// rows take it to 20. `choose()` then runs a whole traversal per option.
//
// Measured rather than guessed at, because "it seemed slow" is not a bound.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 30);
const d = mkdtempSync(join(tmpdir(), 'ct-'));
const e = join(process.cwd(), '.cost-entry.ts');
writeFileSync(e, `export { complex, isLive } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { choose } from './src/domain/choose';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

for (const ARR of [0, 3]) {
	const OPTS = { ...(ARR ? { arrivalHorizon: ARR } : {}) };
	let n = 0, tTrav = 0, tChoose = 0, maxRows = 0;
	const rows = [];
	const t0 = Date.now();
	outer:
	for (const p of P) {
		let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		for (let i = 0; i < p.moves.length; i++) {
			if (i > 0 && i % 2 === 1) {
				n++;
				const c = M.complex(pos, OPTS);
				const per = { white: 0, black: 0 };
				for (const r of c.obligations) if (M.isLive(r, c.board)) per[M.other(r.claimant)]++;
				const worst = Math.max(per.white, per.black);
				rows.push(worst);
				maxRows = Math.max(maxRows, worst);
				let a = Date.now(); M.traverse(c); tTrav += Date.now() - a;
				a = Date.now(); M.choose(pos, OPTS); tChoose += Date.now() - a;
			}
			try { pos = play(pos, p.moves[i]); } catch { break; }
			if (Date.now() - t0 > 45000) break outer;
		}
	}
	rows.sort((a, b) => a - b);
	console.log(
		`arrivals ${ARR}: ${n} plies · traverse ${(tTrav / n).toFixed(1)} ms · choose ${(tChoose / n).toFixed(0)} ms · rows one side median ${rows[rows.length >> 1]} max ${maxRows}`,
	);
}
