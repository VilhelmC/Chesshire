// M5 GATE — the overload overlay, against `deflection` and `attraction`.
//
// ---------------------------------------------------------------------------
// TWO THINGS ARE BEING TESTED AT ONCE and they must not be confused.
//
//   1. DOES THE DETECTOR FIRE ON THE RIGHT POSITIONS? The usual three numbers,
//      stratified by rating x plies-left.
//   2. DOES THE COUNTERFACTUAL ACTUALLY NARROW ANYTHING? `couple.ts` records
//      that a contested-defender test "fires on nearly every position" when
//      asked as a mechanism, so the loose form is measured HERE, beside the
//      strict one, rather than being avoided on the strength of a memory. If
//      "guards two things" and "remove it and two things fall" have the same
//      firing rate, the counterfactual is decoration and should go.
//
// ---------------------------------------------------------------------------
// THE LABEL PROBLEM, stated before the numbers so it cannot be used afterwards
// as an excuse. Lichess has no `overloading` theme. The nearest are:
//
//   deflection  (73 puzzles)  the defender is pulled AWAY — the mechanism
//   attraction  (82 puzzles)  a piece is lured somewhere bad — a cousin, not
//                             the same idea, and included only so the
//                             difference is visible as a number
//
// An overload cashed by capture is a deflection. So `deflection` is the gate and
// `attraction` is a control: if the detector scores the same on both, it is
// picking up "a forcing capture happened" rather than the mechanism.
//
// AND THE MOVE READING IS FIRST, per FINDING-TWO-THIRDS-OF-A-PIN: describing the
// board scored +13.0% where describing the move scored +43.6%.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { overloads, overloadsHeld, overloadsAgainstMover, deflections } from './src/domain/primitives/overload';
export { moves } from './src/domain/primitives/core';
export { seeValue, capturersOn, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { attacks } from 'chessops/attacks';
export { SquareSet } from 'chessops/squareSet';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

/**
 * THE LOOSE FORM, reproduced here and not in the source: a man that simply
 * guards two of its own that the other side bears on. No counterfactual. This is
 * the version `couple.ts` says fires everywhere, and the point of running it is
 * to have the number rather than the memory.
 */
function loose(board, colour) {
	const them = M.other(colour);
	let reach = M.SquareSet.empty();
	for (const from of board[them]) {
		const p = board.get(from);
		if (p) reach = reach.union(M.attacks(p, from, board.occupied));
	}
	const count = new Map();
	for (const square of board[colour].intersect(reach))
		for (const d of M.capturersOn(board, square, colour)) count.set(d, (count.get(d) ?? 0) + 1);
	return [...count.values()].filter((n) => n >= 2).length;
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
			let held = 0;
			let against = 0;
			let cashed = 0;
			let looseN = 0;
			try {
				held = M.overloadsHeld(pos).length;
				against = M.overloadsAgainstMover(pos).length;
				looseN = loose(pos.board, M.other(pos.turn));
				const mv = M.moves(pos).find((m) => same(m, answer));
				cashed = mv ? M.deflections(pos, mv).length : 0;
			} catch {
				/* an empty result is a legitimate reading */
			}
			rows.push({ id: p.id, rating: p.rating, themes: p.themes, left: p.moves.length - i, held, against, cashed, looseN });
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
		`  ${name.padEnd(34)} ${String(fired.length).padStart(5)} ${((100 * fired.length) / rows.length).toFixed(1).padStart(6)}% ${((100 * hit) / Math.max(1, has)).toFixed(1).padStart(7)}% ${(100 * precision).toFixed(1).padStart(7)}% ${
			lift === null ? '     —' : ((lift > 0 ? '+' : '') + (100 * lift).toFixed(1)).padStart(7)
		}% ${(100 * deco).toFixed(1).padStart(7)}%`,
	);
	return lift;
}

const head = () => {
	console.log(`  ${'row'.padEnd(34)} ${'fires'.padStart(5)} ${'rate'.padStart(7)} ${'recall'.padStart(8)} ${'prec'.padStart(7)} ${'LIFT'.padStart(8)} ${'deco'.padStart(8)}`);
	console.log(`  ${'─'.repeat(34)} ───── ─────── ──────── ─────── ──────── ────────`);
};

console.log(`\n  ${rows.length} solver plies from ${done} puzzles`);
for (const t of ['deflection', 'attraction'])
	console.log(`  base rate ${t.padEnd(11)} ${((100 * rows.filter((r) => r.themes.includes(t)).length) / rows.length).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// FIRST: does the counterfactual narrow anything? If these two lines match, the
// expensive half of the detector is doing nothing and should be deleted.
console.log(`\n  ── does the counterfactual narrow anything? ──\n`);
console.log(`  a man guards 2+ (loose)        fires on ${((100 * rows.filter((r) => r.looseN > 0).length) / rows.length).toFixed(1)}% of plies, ${mean(rows.map((r) => r.looseN)).toFixed(2)} per position`);
console.log(`  remove it and 2+ fall (strict) fires on ${((100 * rows.filter((r) => r.held > 0).length) / rows.length).toFixed(1)}% of plies, ${mean(rows.map((r) => r.held)).toFixed(2)} per position`);

console.log(`\n${'─'.repeat(84)}`);
console.log(`\n  ── vs deflection, THE GATE ──\n`);
head();
score('the answer CASHES one', 'deflection', (r) => r.cashed > 0);
score('the mover holds one', 'deflection', (r) => r.held > 0);
score('the mover IS overloaded', 'deflection', (r) => r.against > 0);
score('loose: a man guards 2+', 'deflection', (r) => r.looseN > 0);

console.log(`\n  ── vs attraction, THE CONTROL ──\n`);
head();
score('the answer CASHES one', 'attraction', (r) => r.cashed > 0);
score('the mover holds one', 'attraction', (r) => r.held > 0);

console.log(`\n  ── RULE 8: themes it should NOT predict ──\n`);
head();
for (const t of ['fork', 'pin', 'advancedPawn', 'backRankMate']) score('the answer CASHES one', t, (r) => r.cashed > 0);

console.log(`\n  The gate is \`deflection\`. If \`attraction\` scores the same, the detector is`);
console.log(`  finding "a forcing capture happened" and not the mechanism.\n`);
process.exit(0);
