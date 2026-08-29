// IS THE OVERLOAD DETECTOR MISSING A WHOLE KIND OF CHARGE?
//
// ---------------------------------------------------------------------------
// `m5-overload-gate.mjs` gave a bad reading, and a specific kind of bad:
//
//   vs deflection (the gate)     LIFT  +8.5%   n=27   recall  2.3%
//   vs attraction (the control)  LIFT +10.3%   n=27   recall  2.3%
//   vs fork       (Rule 8)       LIFT  +8.4%
//
// The control scores HIGHER than the gate. That is the signature the gate's own
// header named in advance: the detector is finding "a forcing capture happened
// on a hard puzzle" rather than the mechanism.
//
// But look at the recall before concluding anything. 27 fires against 215
// `deflection` plies is 2.3% — the detector barely fires AT ALL, so what has
// been measured is 27 positions, which is the size the pin ablation's rejected
// rows were. A precision built on 27 fires cannot distinguish a bad mechanism
// from a mechanism that is not being looked for.
//
// ---------------------------------------------------------------------------
// THE HYPOTHESIS, and it is structural rather than a threshold.
//
// A charge, in `overload.ts`, is an enemy MAN whose SEE flips when the defender
// is lifted off. The most common deflection in a puzzle corpus is not that at
// all — it is the rook that has to stay on the back rank. That defender is
// holding an EMPTY SQUARE against mate, and no amount of SEE will ever see it,
// because there is nothing standing there to exchange.
//
// The corpus agrees this should matter: `backRankMate` is 77 puzzles, and the
// whole `mateIn1`/`mateIn2` mass is 241. If king safety is a charge the detector
// structurally cannot represent, the failure is the DEFINITION and the fix is a
// second kind of charge. If adding it changes nothing, the concept does not
// survive and overload does not ship — the same test the relative pin got, and
// the same answer is available.
//
// The variant lives here and not in `overload.ts`. Nothing in the source changes
// until this says which version to keep.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { overloads, overloadsHeld } from './src/domain/primitives/overload';
export { moves, after } from './src/domain/primitives/core';
export { mates } from './src/domain/primitives';
export { seeValue, capturersOn, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { attacks } from 'chessops/attacks';
export { SquareSet } from 'chessops/squareSet';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

/**
 * THE SECOND KIND OF CHARGE: the defender is holding a mate.
 *
 * Lift the defender off the board and ask whether the side to move now has a
 * mate in one they did not have before. That is "this man is the reason you are
 * not being mated", stated as a counterfactual in exactly the same shape as the
 * material one — which matters, because the two must be commensurable if they
 * are to be counted together.
 *
 * A king cannot be lifted, and a defender that is itself giving check makes the
 * counterfactual position illegal; both are skipped rather than guessed at.
 */
function holdsMate(pos, defender) {
	const piece = pos.board.get(defender);
	if (!piece || piece.role === 'king') return false;
	let before;
	try {
		before = M.mates(pos).length;
	} catch {
		return false;
	}
	const without = pos.clone();
	without.board.take(defender);
	let after;
	try {
		after = M.mates(without).length;
	} catch {
		return false; // the counterfactual position is not legal; no claim made
	}
	return after > before;
}

/** Candidate defenders: anything of theirs that guards two things we bear on. */
function candidates(pos) {
	const board = pos.board;
	const colour = M.other(pos.turn);
	const them = pos.turn;
	let reach = M.SquareSet.empty();
	for (const from of board[them]) {
		const p = board.get(from);
		if (p) reach = reach.union(M.attacks(p, from, board.occupied));
	}
	const holds = new Map();
	for (const square of board[colour].intersect(reach)) {
		if (M.seeValue(board, square, them) > 0) continue;
		for (const d of M.capturersOn(board, square, colour)) {
			const l = holds.get(d);
			if (l) l.push(square);
			else holds.set(d, [square]);
		}
	}
	return holds;
}

const rows = [];
let done = 0;

for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const answer = p.moves[i];
			let material = [];
			let mixed = [];
			try {
				const them = pos.turn;
				const holds = candidates(pos);
				for (const [defender, cand] of holds) {
					const without = pos.board.clone();
					without.take(defender);
					const charges = cand.filter((s) => M.seeValue(without, s, them) > 0);
					// v1: two material charges.
					if (charges.length >= 2) material.push({ defender, charges });
					// v2: material charges PLUS the mate it may be holding, counted as
					// one more charge. A defender holding one piece and a mate is
					// overloaded in exactly the sense the word means.
					const mate = holdsMate(pos, defender);
					const total = charges.length + (mate ? 1 : 0);
					if (total >= 2) mixed.push({ defender, charges, mate });
				}
			} catch {
				/* an empty result is a legitimate reading */
			}
			const mv = M.moves(pos).find((m) => same(m, answer));
			const lands = mv ? mv.to : -1;
			const cashes = (list) => list.some((o) => o.defender === lands || o.charges.includes(lands));
			rows.push({
				id: p.id,
				rating: p.rating,
				themes: p.themes,
				left: p.moves.length - i,
				matN: material.length,
				mixN: mixed.length,
				mateOnly: mixed.filter((o) => o.mate && o.charges.length < 2).length,
				matCash: cashes(material),
				mixCash: cashes(mixed),
			});
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (++done % 200 === 0) process.stderr.write(`  ${done} puzzles, ${rows.length} plies\n`);
}

// ---------------------------------------------------------------------------
const ratingBucket = (r) => Math.min(6, Math.floor((r - 400) / 400));
const leftBucket = (l) => (l <= 1 ? 1 : l <= 3 ? 3 : l <= 5 ? 5 : 7);
const cellOf = (row) => `${ratingBucket(row.rating)}|${leftBucket(row.left)}`;

function score(name, theme, fires) {
	const labelled = (r) => r.themes.includes(theme);
	const fired = rows.filter(fires);
	const has = rows.filter(labelled).length;
	const hit = fired.filter(labelled).length;
	const precision = fired.length ? hit / fired.length : 0;
	const cache = {};
	let num = 0;
	let den = 0;
	for (const r of fired) {
		const c = cellOf(r);
		if (!(c in cache)) {
			const cell = rows.filter((x) => cellOf(x) === c);
			cache[c] = cell.length >= 20 ? mean(cell.map((x) => (labelled(x) ? 1 : 0))) : null;
		}
		if (cache[c] !== null) {
			num += cache[c];
			den++;
		}
	}
	const expected = den ? num / den : null;
	const unl = rows.filter((r) => !labelled(r));
	const deco = unl.filter(fires).length / Math.max(1, unl.length);
	const lift = expected === null ? null : precision - expected;
	console.log(
		`  ${name.padEnd(30)} ${String(fired.length).padStart(5)} ${((100 * hit) / Math.max(1, has)).toFixed(1).padStart(7)}% ${(100 * precision).toFixed(1).padStart(7)}% ${
			lift === null ? '     —' : ((lift > 0 ? '+' : '') + (100 * lift).toFixed(1)).padStart(7)
		}% ${(100 * deco).toFixed(1).padStart(7)}%`,
	);
	return lift;
}
const head = () => {
	console.log(`  ${'variant'.padEnd(30)} ${'fires'.padStart(5)} ${'recall'.padStart(8)} ${'prec'.padStart(7)} ${'LIFT'.padStart(8)} ${'deco'.padStart(8)}`);
	console.log(`  ${'─'.repeat(30)} ───── ──────── ─────── ──────── ────────`);
};

console.log(`\n  ${rows.length} solver plies from ${done} puzzles`);
console.log(`  defenders found   material-only ${rows.filter((r) => r.matN > 0).length} plies   +mate ${rows.filter((r) => r.mixN > 0).length} plies`);
console.log(`  of which the mate is what makes it an overload: ${rows.filter((r) => r.mateOnly > 0).length} plies`);

for (const theme of ['deflection', 'attraction', 'backRankMate', 'fork']) {
	console.log(`\n  ── vs ${theme} ──\n`);
	head();
	score('v1: two material charges', theme, (r) => r.matN > 0);
	score('v2: + a mate it is holding', theme, (r) => r.mixN > 0);
	score('v1 CASHED by the answer', theme, (r) => r.matCash);
	score('v2 CASHED by the answer', theme, (r) => r.mixCash);
}

console.log(`\n  If v2 does not clearly beat v1 against \`deflection\` AND stay flat against`);
console.log(`  \`fork\`, the missing charge was not the problem and the concept does not\n  survive. The relative pin got this test and did not survive it either.\n`);
process.exit(0);
