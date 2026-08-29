// WHAT DOES THE REFEREE COST, IF IT WERE THE IMPLEMENTATION?
//
// ---------------------------------------------------------------------------
// `m4-gate.mjs` refereed `hangs` against `quiesce` and found 4.4% of "safe" calls
// lose a pawn or more. The worst of them are not the case the code predicted
// ("two hanging men, only one of which can be saved") but a different one:
//
//     1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b — Rb8 anywhere off the 8th rank
//     8/8/7K/5kP1/7R/8/7p/1r6 w         — Rh4 anywhere off the h-file
//
// In both, the man that moves WAS the defender of a promotion square. Nothing is
// attacked at a profit after the move, so a static per-square exchange sees a
// quiet position; the loss arrives a ply later when the pawn queens. That is not
// a tuning failure, it is the difference between a test and a search, and no
// amount of care inside `hangs` closes it.
//
// So the question is only whether the search is affordable, because if it is
// then the referee should simply BE the implementation and the false-safe rate
// goes to zero by construction. Rule 9 in the other direction: the honest thing
// wins if it also measures better, and it cannot measure worse than the thing it
// is the referee for.
//
// The budget is the panel's: an overlay is drawn on a position the reader is
// looking at, so it has one frame. 100ms is generous and 16ms is invisible.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 300);

const M = await load(`export { moves, hangs } from './src/domain/primitives';
export { quiesce, materialFor } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';`);

const statik = [];
const search = [];
const widths = [];

for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			let all;
			try {
				all = M.moves(pos);
			} catch {
				all = [];
			}
			if (!all.length) break;
			widths.push(all.length);

			// The whole overlay, both ways: every legal move classified.
			let t = performance.now();
			for (const mv of all) M.hangs(pos, mv);
			statik.push(performance.now() - t);

			const us = pos.turn;
			t = performance.now();
			for (const mv of all) {
				const child = pos.clone();
				child.play(mv);
				M.quiesce(child, us);
			}
			search.push(performance.now() - t);
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}

const line = (name, a) =>
	console.log(
		`  ${name.padEnd(22)} mean ${mean(a).toFixed(1).padStart(6)}ms   median ${q(a, 0.5).toFixed(1).padStart(6)}ms   p90 ${q(a, 0.9).toFixed(1).padStart(6)}ms   max ${Math.max(...a).toFixed(0).padStart(5)}ms`,
	);

console.log(`\n  ${statik.length} positions, ${mean(widths).toFixed(0)} legal moves each on average`);
console.log(`  the cost of classifying EVERY move in the position\n`);
line('hangs (static SEE)', statik);
line('quiesce (search)', search);
const over = search.filter((x) => x > 100).length;
console.log(`\n  over 100ms            ${over}/${search.length}  ${((100 * over) / search.length).toFixed(1)}%`);
const over16 = search.filter((x) => x > 16).length;
console.log(`  over one frame (16ms) ${over16}/${search.length}  ${((100 * over16) / search.length).toFixed(1)}%`);
console.log(`  ratio                 ${(mean(search) / Math.max(0.001, mean(statik))).toFixed(1)}x\n`);
process.exit(0);
