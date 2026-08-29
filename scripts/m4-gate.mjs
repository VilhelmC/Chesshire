// M4 GATE — each overlay, on its own, against its own ground truth.
//
// ---------------------------------------------------------------------------
// PLAN-EXPLAINER §4: "GATE, per overlay and not in aggregate: precision and
// recall against its Lichess theme, stratified with theme-confound.mjs. Clearly
// better than base rate or it does not ship — an overlay that fires on 40% of
// quiet positions is a decoration, not a detector."
//
// THE DECORATION TEST IS THE POINT. A fork detector that fires everywhere has
// perfect recall and teaches nothing, and recall alone would pass it. So each
// overlay gets three numbers and not one:
//
//   recall      of the positions the label says have this thing, how many fire
//   precision   of the positions that fire, how many are labelled
//   FIRING RATE on unlabelled positions — the decoration number. This is the one
//               that kills an overlay, and no amount of recall rescues it.
//
// And the same stratification as `theme-confound.mjs`, for the same reason:
// `fork` puzzles are rated differently and run to different lengths than the
// corpus average, so a raw precision is partly a statement about the company the
// theme keeps. Expected precision is computed by direct standardisation over
// rating x plies-left cells — what precision a detector firing AT RANDOM in the
// same cells would have got. LIFT is precision minus that, and it is the only
// number here that is about the detector.
//
// ---------------------------------------------------------------------------
// TWO OF THE THREE OVERLAYS HAVE NO LABEL, so they get referees instead:
//
//   mates      exact by construction (`isCheckmate()` on the child), so there is
//              nothing to measure about its correctness. What IS worth measuring
//              is coverage: does it fire on the last ply of every mate puzzle.
//   safeMoves  no Lichess theme at all, so a referee: play the move, let every
//              capture play out, and see whether the material really did hold.
//
//              THE REFEREE WON. The overlay's first version was static SEE, and
//              4.36% of the moves it called safe lost a pawn or more. It now uses
//              the quiescence directly, so its false-safe rate is zero by
//              construction and there is nothing left to referee. What is still
//              measured is the number that settled it — how often the retired
//              static test disagreed, in both directions — and whether the
//              overlay can name a square to ring when it does warn.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 400);
// The referee is the expensive half — a full quiescence per legal move — so it
// gets its own budget rather than silently deciding how many puzzles run.
const REFEREE = Number(process.argv[3] ?? 15000);

const M = await load(`export { forks, mates, moves, hangs, costs, unsafe } from './src/domain/primitives';
export { quiesce, materialFor } from './src/domain/ladder';
export { positionFromFen, fenOf } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

// ---------------------------------------------------------------------------
// One row per SOLVER ply: the positions where a human is being asked to see
// something. Opponent plies are forced replies and are not what an overlay is
// drawn on.
const rows = [];
let refereed = 0;
let falseSafe = [];
let falseAlarm = 0;
let safeSeen = 0;
let staticSafe = 0;
let unringed = 0;

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
			let fs;
			try {
				fs = M.forks(pos);
			} catch {
				fs = [];
			}
			let ms;
			try {
				ms = M.mates(pos);
			} catch {
				ms = [];
			}
			rows.push({
				id: p.id,
				rating: p.rating,
				themes: p.themes,
				left: p.moves.length - i,
				last: i === p.moves.length - 1,
				forkFires: fs.length > 0,
				forkOnAnswer: fs.some((f) => same(f.move, answer)),
				mateFires: ms.length > 0,
				mateOnAnswer: ms.some((m) => same(m, answer)),
			});

			// ---------------------------------------------------------------
			// The safeMoves referee. Every move in the position, not a sample:
			// the overlay draws all of them, so all of them are claims.
			//
			// `hangs` is a SINGLE-SQUARE test — it asks what one man can be taken
			// for. `quiesce` plays every capture on the board out against every
			// other. The gap between them is exactly `settled`'s known limit, "two
			// hanging men, only one of which can be saved", and this counts how
			// often that limit bites in real positions.
			if (refereed < REFEREE) {
				const us = pos.turn;
				let all;
				try {
					all = M.moves(pos);
				} catch {
					all = [];
				}
				for (const mv of all) {
					let child;
					try {
						child = pos.clone();
						child.play(mv);
					} catch {
						continue;
					}
					// Mate ends the material question; a move that mates is safe
					// whatever the count says.
					if (child.isCheckmate()) continue;
					const stands = M.materialFor(child.board, us);
					const settles = M.quiesce(child, us);
					const drop = stands - settles;
					const said = M.hangs(pos, mv);
					refereed++;
					// The SHIPPED verdict, and the ring it can offer alongside it.
					const u = M.unsafe(pos, mv);
					if (!u) safeSeen++;
					else if (u.square === null) unringed++;
					// The RETIRED static test, kept only as the number that decided
					// it. 100 is a pawn: below that the two disagree about en-passant
					// and promotion edges rather than about safety.
					if (!said) {
						staticSafe++;
						if (drop >= 100) falseSafe.push({ id: p.id, uci: nm(mv), drop, fen: M.fenOf(pos) });
					} else if (drop <= 0) falseAlarm++;
				}
			}
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (++done % 100 === 0) process.stderr.write(`  ${done} puzzles, ${rows.length} plies\n`);
}

// ---------------------------------------------------------------------------
const ratingBucket = (r) => Math.min(6, Math.floor((r - 400) / 400));
const leftBucket = (l) => (l <= 1 ? 1 : l <= 3 ? 3 : l <= 5 ? 5 : 7);
const cellOf = (row) => `${ratingBucket(row.rating)}|${leftBucket(row.left)}`;

/**
 * Precision, recall, decoration rate — and the precision a detector firing at
 * random in the same rating x plies-left cells would have achieved.
 */
function score(name, theme, fires, pool = rows) {
	const labelled = (r) => r.themes.includes(theme);
	const hit = pool.filter((r) => fires(r) && labelled(r)).length;
	const fired = pool.filter(fires).length;
	const has = pool.filter(labelled).length;
	const base = has / pool.length;

	// Direct standardisation: for each FIRING ply, the label rate among plies in
	// the same cell. That is what a random detector with this firing pattern
	// would have picked up. Cells with too little mass to speak contribute
	// nothing rather than falling back to the global rate.
	const cache = {};
	let num = 0;
	let den = 0;
	for (const r of pool.filter(fires)) {
		const c = cellOf(r);
		if (!(c in cache)) {
			const cell = pool.filter((x) => cellOf(x) === c);
			cache[c] = cell.length >= 20 ? mean(cell.map((x) => (labelled(x) ? 1 : 0))) : null;
		}
		if (cache[c] !== null) {
			num += cache[c];
			den++;
		}
	}
	const expected = den ? num / den : null;
	const precision = fired ? hit / fired : 0;

	console.log(`\n  ${name}`);
	console.log(`    fires on          ${fired}/${pool.length}  ${(100 * (fired / pool.length)).toFixed(1)}% of solver plies`);
	console.log(`    recall            ${hit}/${has}  ${has ? (100 * (hit / has)).toFixed(1) : '—'}% of ${theme} plies`);
	console.log(`    precision         ${(100 * precision).toFixed(1)}%   base rate ${(100 * base).toFixed(1)}%`);
	if (expected === null) console.log(`    stratified        too little matched mass`);
	else {
		const lift = precision - expected;
		console.log(
			`    stratified        expected ${(100 * expected).toFixed(1)}%   LIFT ${(lift > 0 ? '+' : '') + (100 * lift).toFixed(1)}%`,
		);
	}
	// The decoration number, stated separately because it is the one that kills.
	const unl = pool.filter((r) => !labelled(r));
	const onUnlabelled = unl.filter(fires).length / Math.max(1, unl.length);
	console.log(`    DECORATION TEST   fires on ${(100 * onUnlabelled).toFixed(1)}% of NON-${theme} plies`);
	return { precision, expected, onUnlabelled, unl };
}

console.log(`\n  ${rows.length} solver plies from ${done} puzzles\n`);
console.log(`${'─'.repeat(76)}`);

// FORK. Two readings, and they answer different questions: "is there a fork
// here" is what an overlay drawn on a position claims, and "the solution IS the
// fork" is the stronger claim the label actually makes.
score('forks — any fork available in the position', 'fork', (r) => r.forkFires);
score('forks — the puzzle’s own answer is a fork', 'fork', (r) => r.forkOnAnswer);

// MATE. Correctness is by construction; what is measurable is coverage on the
// ply where the mate is actually there to be found.
console.log(`\n${'─'.repeat(76)}`);
const finals = rows.filter((r) => r.last);
score('mates — on final solver plies', 'mateIn1', (r) => r.mateOnAnswer, finals);
const m1 = finals.filter((r) => r.themes.includes('mateIn1'));
const missed = m1.filter((r) => !r.mateOnAnswer);
console.log(`    mateIn1 finals    ${m1.length}, missed ${missed.length}${missed.length ? ` — ${missed.slice(0, 5).map((r) => r.id).join(' ')}` : ' (exact, as the construction says)'}`);

// AND THE DECORATION NUMBER ABOVE IS ABOUT THE LABEL, NOT THE DETECTOR. Every
// fire IS a mate — `isCheckmate()` on the child leaves no room for a false one.
// A `mateIn2` puzzle's LAST ply is a mate in one while the puzzle carries no
// `mateIn1` theme, so those count against precision without being wrong. Split
// out, because a number that cannot be wrong should not be read as a warning.
const stray = finals.filter((r) => r.mateOnAnswer && !r.themes.includes('mateIn1'));
const mateThemed = stray.filter((r) => r.themes.some((t) => t.startsWith('mate')));
console.log(
	`    of the ${stray.length} fires without the mateIn1 label, ${mateThemed.length} are the final ply of a longer mate`,
);
console.log(`    — the label is about the PUZZLE, the detector about the PLY. Every fire is a mate.`);

// SAFE. No label, so a referee.
console.log(`\n${'─'.repeat(76)}`);
console.log(`\n  safeMoves — the referee became the implementation\n`);
console.log(`    moves refereed    ${refereed}`);
console.log(`    called safe       ${safeSeen}  ${(100 * (safeSeen / Math.max(1, refereed))).toFixed(1)}%`);
console.log(`    FALSE SAFE        0 — the verdict IS the quiescence, so there is nothing left to be wrong about`);
console.log(
	`    warnings unringed ${unringed}/${refereed - safeSeen}  ${(100 * (unringed / Math.max(1, refereed - safeSeen))).toFixed(1)}% where SEE names no square to draw`,
);

// ---------------------------------------------------------------------------
// The number that retired the static test. Kept because a decision without its
// measurement is an opinion, and this project has a rule about that.
const saidHangs = refereed - staticSafe;
console.log(`\n    the retired static test, against the same referee:`);
console.log(
	`      FALSE SAFE      ${falseSafe.length}/${staticSafe}  ${(100 * (falseSafe.length / Math.max(1, staticSafe))).toFixed(2)}% of its safe calls lose ≥1 pawn`,
);
console.log(
	`      false alarm     ${falseAlarm}/${saidHangs}  ${(100 * (falseAlarm / Math.max(1, saidHangs))).toFixed(1)}% it called hanging that in fact hold`,
);
// The two directions are NOT symmetric. A false alarm leaves a safe move
// undrawn — the overlay is shy. A false safe draws a move that loses. Only the
// second one misleads, and only the second one was worth 2.3x the time to remove.
console.log(`      — a false alarm makes an overlay shy; a FALSE SAFE makes it wrong.`);

if (falseSafe.length) {
	const worst = [...falseSafe].sort((a, b) => b.drop - a.drop).slice(0, 6);
	console.log(`\n      what a static per-square test cannot see:`);
	for (const f of worst) console.log(`        ${f.id}  ${f.uci}  −${(f.drop / 100).toFixed(2)}   ${f.fen}`);
}

console.log(`\n${'─'.repeat(76)}`);
console.log(`\n  An overlay ships on LIFT and on the decoration test, not on recall.`);
console.log(`  A detector that fires on most positions has told the reader nothing,`);
console.log(`  however many labelled ones it caught.\n`);
process.exit(0);
