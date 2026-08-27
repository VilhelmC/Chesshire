// The M7 gate: does the stack pick the puzzle's move?
//
// Asked the way PLAN.md requires — per-ply, solver plies only, same corpus,
// identical basis — and asked of `choose()`, which reads the edit off the graph
// rather than scoring legal moves.
//
// A TIE AT THE TOP COUNTS AS A MISS. Will: "no moves can be tied, other than
// equivalent non-zero scores", so a surviving tie is a statement about the
// complex and not a decision to be made by a tie-break. Counted separately as
// well, because a tie CONTAINING the answer and a miss are different failures:
// the first says the complex is too coarse, the second says it is wrong.
//
// SOLVER PLIES ARE THE ODD INDICES, and the first version of this script used the
// even ones. The corpus is in Lichess form: `fen` is the position BEFORE the
// opponent's move, `moves[0]` is that move, and the solver's first move is
// `moves[1]`. Measured rather than assumed, after getting it wrong: over 300
// lines, the side moving at index 0 is the one the line ends up favouring in 8.0%
// of them and the other side in 83.3%. Every other harness in the repo already
// used the odd indices, so the first version was also not on the baseline's basis
// — which PLAN.md forbids in as many words.
//
// Also reported: how often the answer was not in the option set at all. That is
// the option set's own recall, and it bounds everything else — no pricing can
// find a move the graph never named.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'gt-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex } from './src/domain/complex';
export { choose, options } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const OPTS = { ...(ARR ? { arrivalHorizon: ARR } : {}), ...(process.env.BILL === '0' ? { billDefence: false } : {}) };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let plies = 0, outright = 0, tied = 0, tiedWithAnswer = 0, missed = 0, notOffered = 0, noOptions = 0;
const sizes = [];
const misses = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	// Solver plies only: the moves the side to move is being asked to find.
	for (let i = 0; i < p.moves.length; i++) {
		const isSolver = i > 0 && i % 2 === 1;
		if (isSolver) {
			plies++;
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			const { best, all } = M.choose(pos, OPTS);
			sizes.push(all.length);
			const offered = all.some((x) => x.from === want.from && x.to === want.to);
			if (!all.length) noOptions++;
			if (!offered) notOffered++;
			const hit = best.some((x) => x.from === want.from && x.to === want.to);
			if (hit && best.length === 1) outright++;
			else if (hit) { tied++; tiedWithAnswer++; }
			else {
				missed++;
				if (best.length > 1) tied++;
				if (misses.length < 8)
					misses.push(`${p.id} ply ${i}  wanted ${p.moves[i]}, chose ${best.map((x) => sq(x.from) + sq(x.to) + '=' + x.value).join(' ')} of ${all.length}\n      ${M.makeFen(pos.toSetup())}`);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (x) => `${((100 * x) / plies).toFixed(1)}%`;
sizes.sort((a, b) => a - b);
console.log(`\n${plies} solver plies${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
console.log(`  outright                : ${outright} (${pc(outright)})`);
console.log(`  in a tie at the top     : ${tiedWithAnswer} (${pc(tiedWithAnswer)})`);
console.log(`  ceiling (outright+tie)  : ${pc(outright + tiedWithAnswer)}`);
console.log(`  missed                  : ${missed} (${pc(missed)})`);
console.log(`\n  answer not in the option set : ${notOffered} (${pc(notOffered)})   <- bounds everything above`);
console.log(`  no options at all            : ${noOptions} (${pc(noOptions)})`);
console.log(`  option-set size, median / p90 / max : ${sizes[sizes.length >> 1]} / ${sizes[Math.floor(sizes.length * 0.9)]} / ${sizes[sizes.length - 1]}\n`);
for (const x of misses) console.log(`  ${x}\n`);
