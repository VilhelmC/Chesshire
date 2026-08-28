// IS THE LEAF STABLE? — the one question that decides whether depth 2 can be
// trusted to mean anything.
//
// ---------------------------------------------------------------------------
// A search is only as honest as its leaves. If the evaluation at the horizon is
// mid-exchange, then asking the same question two plies deeper gives a different
// answer, and the number the shallow search reported was measuring the horizon
// rather than the position. So the test is not "is the value right" — there is
// nothing to compare it to — but:
//
//     does deepening CHANGE it?
//
// deep(2) against deep(4), same leaf evaluation on both sides, so depth is the
// only variable. A stable leaf makes them agree; an unstable one does not, and
// the disagreement rate IS the horizon effect, in units of how often the ladder
// says "forced" about something that is not.
//
// Two leaves, measured side by side:
//
//   settled   material + the single best exchange for the side to move. Its own
//             comment names the limit — "two hanging men, only one of which can
//             be saved" — and this puts a number on it.
//   quiesce   every capture, alternating, until neither side wants another,
//             with stand-pat so nobody is forced into a losing capture.
//
// RULE 7: the mechanism being replaced is measured beside its replacement, on
// the same positions, in the same run. Not against a figure from an earlier
// session in a container that no longer exists — that confound has already cost
// this project two retracted comparisons.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 60);
const CAP = Number(process.argv[3] ?? 120);

const M = await load(`export { settled, quiesce, materialFor, allMoves, guarantees } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const after = (pos, m) => {
	const n = pos.clone();
	n.play(m);
	return n;
};

/** The two leaves, behind one signature so the search below cannot tell them apart. */
const LEAVES = {
	settled: (pos, attacker) => M.settled(pos.board, pos.turn, attacker),
	quiesce: (pos, attacker) => M.quiesce(pos, attacker),
};

// Full-width minimax with an ALPHA-BETA window. The window is exact — it prunes
// only branches that provably cannot change the value at the root — so this
// returns what the unpruned search returns and the control below still holds.
// Without it a 4-ply referee is 27,000 leaf evaluations a position and the run
// does not finish.
function node(pos, left, attacker, leaf, alpha, beta) {
	if (pos.isCheckmate()) return pos.turn === attacker ? -Infinity : Infinity;
	const moves = M.allMoves(pos);
	if (!moves.length || left <= 0) return leaf(pos, attacker);
	const mine = pos.turn === attacker;
	if (mine) {
		let best = -Infinity;
		for (const m of moves) {
			const v = node(after(pos, m), left - 1, attacker, leaf, alpha, beta);
			if (v > best) best = v;
			if (best > alpha) alpha = best;
			if (alpha >= beta) break;
		}
		return best;
	}
	let best = Infinity;
	for (const m of moves) {
		const v = node(after(pos, m), left - 1, attacker, leaf, alpha, beta);
		if (v < best) best = v;
		if (best < beta) beta = best;
		if (alpha >= beta) break;
	}
	return best;
}
const deep = (pos, move, attacker, plies, leaf) =>
	node(after(pos, move), plies - 1, attacker, leaf, -Infinity, Infinity);

// ---------------------------------------------------------------------------
// CONTROL: with the `settled` leaf, deep(2) must reproduce `guarantees` exactly.
// It is the same computation written twice, and if the two disagree then this
// script is measuring itself. A previous version of this comparison was wrong
// about PARITY and its control is what said so.
// ---------------------------------------------------------------------------
{
	let n = 0;
	let same = 0;
	const bad = [];
	outer: for (const p of puzzles(30)) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		for (let i = 0; i < p.moves.length; i++) {
			if (i % 2 === 1)
				for (const m of M.allMoves(pos).slice(0, 6)) {
					n++;
					const a = M.guarantees(pos, m, pos.turn);
					const b = deep(pos, m, pos.turn, 2, LEAVES.settled);
					if (a === b) same++;
					else if (bad.length < 5) bad.push(`${p.id} ${nm(m)}: ${a} vs ${b}`);
					if (n >= 900) break outer;
				}
			try {
				pos = play(pos, p.moves[i]);
			} catch {
				break;
			}
		}
	}
	console.log(`\n  CONTROL — deep(2, settled) against guarantees: ${same}/${n}`);
	if (same !== n) {
		console.log(`  MEASURING ITSELF. Stop.\n    ${bad.join('\n    ')}`);
		process.exit(1);
	}
}

const plies = [];
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) plies.push({ id: p.id, rating: p.rating, pos, themes: p.themes });
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}

const out = {};
for (const name of ['settled', 'quiesce']) {
	const leaf = LEAVES[name];
	let n = 0;
	let stable = 0;
	const gap = [];
	let ms = 0;
	for (const s of plies) {
		const attacker = s.pos.turn;
		// The move the shallow search would pick, judged by that same leaf.
		let pick = null;
		let best = -Infinity;
		const t0 = Date.now();
		for (const m of M.allMoves(s.pos)) {
			const v = deep(s.pos, m, attacker, 2, leaf);
			if (v > best) {
				best = v;
				pick = m;
			}
		}
		if (!pick) continue;
		const d4 = deep(s.pos, pick, attacker, 4, leaf);
		ms += Date.now() - t0;
		n++;
		if (d4 >= best - 0.5) stable++;
		else gap.push(best - d4);
		if (n >= CAP) break;
	}
	out[name] = { n, stable, gap, ms };
	console.log(
		`\n  ${name.toUpperCase().padEnd(8)} ${n} positions, ${(ms / n).toFixed(0)}ms each` +
			`\n    deepening changes nothing   ${String(stable).padStart(4)}  ${((100 * stable) / n).toFixed(1)}%` +
			`\n    deepening takes it back     ${String(n - stable).padStart(4)}  ${((100 * (n - stable)) / n).toFixed(1)}%` +
			(gap.length
				? `\n    given back: mean ${mean(gap.filter(Number.isFinite)).toFixed(0)}cp  median ${q(gap.filter(Number.isFinite), 0.5)}  mated ${gap.filter((x) => !Number.isFinite(x)).length}`
				: ''),
	);
}

const a = out.settled;
const b = out.quiesce;
console.log(
	`\n  settled -> quiesce   stability ${((100 * a.stable) / a.n).toFixed(1)}% -> ${((100 * b.stable) / b.n).toFixed(1)}%` +
		`   cost x${(b.ms / a.ms).toFixed(1)}`,
);
