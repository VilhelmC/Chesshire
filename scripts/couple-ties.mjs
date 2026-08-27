// Do couplings live where the ledger cannot decide?
//
// PLAN.md's M5 done-when is partly "the two-way ties in the baseline's
// unresolved bucket fall". That needs the tree, which is not built. This asks
// the weaker question the evidence CAN answer: are couplings concentrated on
// the plies where the ledger currently ties, or are they spread evenly?
//
// A concentration is evidence the tree would pay. An even spread would mean the
// couplings are real and irrelevant, which is worth knowing before building
// anything on them.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ct-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { couplings } from './src/domain/couple';
export { gamma, cover, concede, due } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

// "Decided" = one move covers everything due, and there is something due. Ties
// and blanks are everything else, split so neither hides in the other.
let plies = 0;
const box = { decided: [0, 0, 0], tied: [0, 0, 0], blank: [0, 0, 0] };
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const owed = pos.turn;
			const g = M.gamma(pos, { owed });
			const nDue = M.due(g).length;
			const bucket = !nDue ? 'blank' : M.cover(g).move ? 'decided' : 'tied';
			// "Any coupling on the board" is too coarse: a coupling in the corner
			// cannot break a tie between two obligations elsewhere. The sharper
			// question is whether a coupling TOUCHES a square the ledger is
			// currently unable to decide about.
			const owedSquares = new Set(g.E.map((x) => x.square));
			const cs = M.couplings(pos.board);
			const coupled = cs.length > 0;
			const relevant = cs.some((c) => (c.kind === 'commitment'
				? [c.piece, ...c.holds] : [c.from, c.to]).some((s) => owedSquares.has(s)));
			box[bucket][0]++;
			if (coupled) box[bucket][1]++;
			if (relevant) box[bucket][2]++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${P.length} puzzles · ${plies} solver plies\n`);
console.log('  bucket    plies   any coupling      touching an obligation');
for (const [k, [n, c, r]] of Object.entries(box))
	console.log(`  ${k.padEnd(8)} ${String(n).padStart(5)}   ${String(c).padStart(5)} (${n ? (100*c/n).toFixed(1) : '0.0'}%)` +
		`        ${String(r).padStart(5)} (${n ? (100*r/n).toFixed(1) : '0.0'}%)`);
