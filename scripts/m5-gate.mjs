// M5 GATE — the pin overlay, against the `pin` theme.
//
// ---------------------------------------------------------------------------
// The same three numbers M4 used, for the same reasons:
//
//   recall      of the plies the label says have this thing, how many fire
//   precision   of the plies that fire, how many are labelled
//   DECORATION  the firing rate on unlabelled plies — the one that kills
//
// stratified by rating x plies-left exactly as `theme-confound.mjs` does, so
// that a precision is about the detector and not about the company the theme
// keeps.
//
// ---------------------------------------------------------------------------
// WHAT THIS GATE MEASURES NOW, AND WHAT IT MEASURED FIRST.
//
// The first run scored three kinds — absolute pin, relative pin, skewer — one
// function having found all three. Two did not survive: `scripts/m5-ablate.mjs`
// put the relative pin and the skewer at the base rate however they were
// narrowed, and `primitives/pin.ts` records the six narrowings and the Rule 8
// control that licensed the deletion.
//
// So the rows below are the surviving detector plus the rows that show WHY the
// others went. Those are kept deliberately: a gate that only prints what shipped
// is a gate nobody can check the shape of. The `held` rows in particular are the
// difference between describing the board and describing a move, and that
// difference is +9.0% against +43.6%.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { pins, pinsOn, pinsCreated, pinsAgainstMover, pinsHeld } from './src/domain/primitives/pin';
export { moves } from './src/domain/primitives/core';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

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
			let held = [];
			let against = [];
			let made = [];
			try {
				held = M.pinsHeld(pos);
				against = M.pinsAgainstMover(pos);
				const mv = M.moves(pos).find((m) => same(m, answer));
				made = mv ? M.pinsCreated(pos, mv) : [];
			} catch {
				/* keep the row; an empty detector result is a legitimate reading */
			}
			rows.push({
				id: p.id,
				rating: p.rating,
				themes: p.themes,
				left: p.moves.length - i,
				// Three readings, and they are NOT the same claim:
				//   held      the mover already has one on the board
				//   against   the mover's own man is stuck
				//   made      the puzzle's answer CREATES one
				held,
				against,
				made,
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
	const has = rows.filter(labelled);
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

	console.log(`\n  ${name}   [vs ${theme}]`);
	console.log(`    fires on          ${fired.length}/${rows.length}  ${(100 * (fired.length / rows.length)).toFixed(1)}%`);
	console.log(`    recall            ${hit}/${has.length}  ${has.length ? (100 * (hit / has.length)).toFixed(1) : '—'}%`);
	console.log(
		`    precision         ${(100 * precision).toFixed(1)}%   ${expected === null ? '(no matched mass)' : `expected ${(100 * expected).toFixed(1)}%   LIFT ${(precision - expected > 0 ? '+' : '') + (100 * (precision - expected)).toFixed(1)}%`}`,
	);
	console.log(`    DECORATION        ${(100 * deco).toFixed(1)}% of non-${theme} plies`);
	return { precision, expected, deco, n: fired.length };
}

console.log(`\n  ${rows.length} solver plies from ${done} puzzles`);
const baseP = rows.filter((r) => r.themes.includes('pin')).length / rows.length;
console.log(`  base rate: pin ${(100 * baseP).toFixed(1)}%`);
console.log(`\n${'─'.repeat(76)}`);

// THE SHIPPED READING: the answer creates a pin. This is what the theme labels.
console.log(`\n  ── SHIPPED: the answer CREATES an absolute pin ──`);
score('pinsCreated', 'pin', (r) => r.made.length > 0);

// The control that licensed the deletion, kept visible. If a later change makes
// the detector fire on unrelated themes, this is where it shows.
console.log(`\n${'─'.repeat(76)}`);
console.log(`\n  ── RULE 8 CONTROL: the same row against themes it should NOT predict ──`);
for (const t of ['fork', 'backRankMate', 'advancedPawn', 'sacrifice', 'skewer'])
	score('pinsCreated', t, (r) => r.made.length > 0);

// THE WEAK READING, kept because the gap is the point: a detector that reports
// the standing state of the board is describing the board, not the move.
console.log(`\n${'─'.repeat(76)}`);
console.log(`\n  ── NOT SHIPPED: one already EXISTS on the board ──`);
score('the mover holds one', 'pin', (r) => r.held.length > 0);
score('the mover IS pinned', 'pin', (r) => r.against.length > 0);

console.log(`\n${'─'.repeat(76)}`);
console.log(`\n  A row ships on LIFT and on the decoration number. A row that fires on`);
console.log(`  most plies has told the reader nothing, whatever its recall.\n`);
process.exit(0);
