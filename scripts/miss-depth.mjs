// WOULD DEPTH FIX THE ONES WE GET WRONG? — asked only of the ones we get wrong.
//
// The aggregate said depth 4 buys +1 answer in 60 at 34x the cost, which is a
// clear no. But an aggregate over positions we already solve cannot say much: 90%
// of them were never going to change. The question that matters is narrower —
//
//     of the positions the 2-ply rung gets WRONG, how many does 4 fix? 6?
//
// If the answer is "most of them", depth is worth buying and the only argument is
// about price. If it is "almost none", then the misses are not a horizon problem
// at all and no affordable search will touch them — which sends the work back to
// the mechanism rather than the depth, and is worth knowing before building
// anything else.
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 200);
const CAP = Number(process.argv[3] ?? 40);

const M = await load(`export { holds, materialFor, allMoves, ladderReport } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

function rungAt(pos, depth, order) {
	const attacker = pos.turn;
	const moves = order ?? M.allMoves(pos);
	let best = -Infinity;
	let picks = [];
	const scored = [];
	for (const m of moves) {
		const v = M.holds(pos, m, attacker, depth, best - 0.5, Infinity);
		scored.push({ m, v });
		if (v > best + 0.5) {
			best = v;
			picks = [m];
		} else if (v > best - 0.5) picks.push(m);
	}
	scored.sort((a, b) => b.v - a.v);
	return { value: best - M.materialFor(pos.board, attacker), moves: picks, order: scored.map((s) => s.m) };
}

// Collect the plies the FULL ladder gets wrong — mate rung included, so a
// position the king rung already answers is not counted against the material one.
const misses = [];
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			let r;
			try {
				r = M.ladderReport(pos, 5);
			} catch {
				r = null;
			}
			if (r && !r.moves.some((m) => nm(m).slice(0, 4) === p.moves[i].slice(0, 4)))
				misses.push({ id: p.id, rating: p.rating, pos, want: p.moves[i], themes: p.themes, forced: r.forced });
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (misses.length >= CAP) break;
}

console.log(`\n  ${misses.length} solver plies the ladder gets WRONG at depth 5\n`);

const fixed = { 4: 0 };
const ms = { 4: 0 };
const rows = [];
for (const s of misses) {
	const shallow = rungAt(s.pos, 2, null);
	const line = [`${s.id} (${s.rating}) ${s.themes.slice(0, 2).join(',').padEnd(24)} want ${s.want}`];
	for (const d of [4]) {
		const t0 = Date.now();
		let r;
		try {
			r = rungAt(s.pos, d, shallow.order);
		} catch {
			r = null;
		}
		ms[d] += Date.now() - t0;
		const ok = r && r.moves.some((m) => nm(m).slice(0, 4) === s.want.slice(0, 4));
		if (ok) fixed[d]++;
		line.push(`d${d} ${ok ? 'FIXED' : ' no  '} ${r ? r.moves.slice(0, 2).map(nm).join(' ') : '—'}`);
	}
	rows.push(line.join('   '));
}

const n = misses.length;
for (const d of [4])
	console.log(
		`  depth ${d}   fixes ${String(fixed[d]).padStart(3)}/${n}  ${((100 * fixed[d]) / n).toFixed(1)}%` +
			`   ${(ms[d] / n).toFixed(0)}ms a position`,
	);
console.log(`\n  ${rows.slice(0, 30).join('\n  ')}`);
