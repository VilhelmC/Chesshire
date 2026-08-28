// WHAT DOES DEPTH BUY? — the question nobody asked before fixing it at 3.
//
// `depth` in `ladderReport` reaches exactly ONE thing: the king rung's `solve`.
// The material rungs are `guaranteeWithHeld`, a one-ply minimum over the
// defender's replies with SEE at the leaf, and they do not take a depth at all.
// So this sweep is not "how deep does the ladder search" — it is "how far can
// the mate rung see", and every other rung is a constant across the columns.
//
// Reported per depth:
//   found / tied / wrong   the corpus verdict, same script as the 65.3% run
//   MATE                   how many plies the king rung answered
//   mate correct           of those, how many named the puzzle's move
//   ms/ply                 the cost, which is the whole reason 3 was ever chosen
//
// A depth that finds more mates and prices them wrongly is worse than one that
// finds fewer, so the two mate columns are reported separately rather than as a
// rate.
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 200);
const DEPTHS = (process.argv[3] ?? '3,5,7').split(',').map(Number);

const M = await load(`export { ladderReport } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

// The solver plies: every position where WE are asked to find a move. Built once
// so all depths see exactly the same list — the confound that cost this project
// two retracted before/after comparisons.
const plies = [];
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) plies.push({ id: p.id, pos, want: p.moves[i], themes: p.themes });
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}
console.log(`\n  ${plies.length} solver plies over ${N} puzzles — the SAME list at every depth\n`);

const rows = [];
for (const depth of DEPTHS) {
	let found = 0,
		tied = 0,
		wrong = 0,
		mates = 0,
		mateRight = 0,
		unforced = 0;
	const ms = [];
	const nodes = [];
	const gained = [];
	for (const s of plies) {
		const t0 = Date.now();
		let r;
		try {
			r = M.ladderReport(s.pos, depth);
		} catch {
			continue;
		}
		ms.push(Date.now() - t0);
		nodes.push(r.nodes);
		const hit = r.moves.some((m) => nm(m).slice(0, 4) === s.want.slice(0, 4));
		if (!hit) wrong++;
		else if (r.moves.length > 1) tied++;
		else found++;
		if (r.value === 'mate') {
			mates++;
			if (hit) mateRight++;
			else gained.push(`${s.id} d${depth}`);
		}
		if (!r.forced) unforced++;
	}
	const n = plies.length;
	rows.push({ depth, found, tied, wrong, mates, mateRight, unforced, ms: mean(ms), p90: q(ms, 0.9), nodes: mean(nodes) });
	console.log(
		`  depth ${String(depth).padStart(2)}   found ${String(found).padStart(4)} (${((100 * found) / n).toFixed(1)}%)` +
			`   tied ${String(tied).padStart(4)}   wrong ${String(wrong).padStart(4)} (${((100 * wrong) / n).toFixed(1)}%)` +
			`   MATE ${String(mates).padStart(4)} of which right ${String(mateRight).padStart(4)}` +
			`   unforced ${String(unforced).padStart(4)}` +
			`   ${mean(ms).toFixed(0).padStart(5)}ms/ply  p90 ${String(q(ms, 0.9)).padStart(5)}ms   ${mean(nodes).toFixed(0).padStart(6)} nodes`,
	);
}

// THE DELTAS, because a table of absolutes hides what a step actually costs.
console.log('');
for (let i = 1; i < rows.length; i++) {
	const a = rows[i - 1],
		b = rows[i];
	console.log(
		`  ${a.depth} → ${b.depth}   found ${b.found - a.found >= 0 ? '+' : ''}${b.found - a.found}` +
			`   wrong ${b.wrong - a.wrong >= 0 ? '+' : ''}${b.wrong - a.wrong}` +
			`   mates ${b.mates - a.mates >= 0 ? '+' : ''}${b.mates - a.mates} (right ${b.mateRight - a.mateRight >= 0 ? '+' : ''}${b.mateRight - a.mateRight})` +
			`   cost ×${(b.ms / Math.max(0.001, a.ms)).toFixed(1)}`,
	);
}
