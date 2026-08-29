// WHAT DOES THE MATE WHEEL COST? — asked before it is written, not after.
//
// ---------------------------------------------------------------------------
// `domain/wheels.ts` promises the menu is instant: "Nothing here touches an
// engine, which is what makes the menu instant — every one of these is a board
// computation, and the most expensive is a few milliseconds."
//
// Will wants the mate wheel to draw the whole forced LINE rather than mate in
// one, and that is a df-pn search, not a board computation. So the promise is
// either kept or rewritten, and which one depends on a number nobody has:
//
//   the WHOLE ladder is about 500ms a ply, but that is every rung.
//   the MATE RUNG alone terminates on isCheckmate() and should be far cheaper.
//
// If the mate rung is a few milliseconds on ordinary positions the wheel stays
// synchronous and the promise holds. If it is not, the wheel needs the async
// shape LadderPanel already has, and the file's header is wrong and must change.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 300);
const DEPTH = Number(process.argv[3] ?? 5);

const M = await load(`export { mateGoal, allMoves } from './src/domain/ladder';
export { solve } from './src/domain/pns';
export { positionFromFen } from './src/domain/chess';`);

const after = (p, m) => { const n = p.clone(); n.play(m); return n; };

/** Exactly what a mate wheel would run: is there a forced mate, and what is it. */
function mateSolve(pos, depth) {
	const goal = M.mateGoal(pos.turn, { narrow: true, seed: true });
	for (const m of M.allMoves(pos)) {
		const r = M.solve(goal, after(pos, m), depth - 1);
		if (r.refuted) return m;
	}
	return null;
}

/** PROBE THEN DEEPEN — what the overlay actually runs, so what must be priced. */
function mateSolveProbed(pos, depth) {
	const goal = M.mateGoal(pos.turn, { narrow: true, seed: true });
	let any = false;
	for (const m of M.allMoves(pos)) if (M.solve(goal, after(pos, m), depth - 1).refuted) { any = true; break; }
	if (!any) return null;
	for (let d = 1; d <= depth; d++)
		for (const m of M.allMoves(pos)) if (M.solve(goal, after(pos, m), d - 1).refuted) return m;
	return null;
}

/** Deepening with no probe — correct, and it pays on every position. */
function mateSolveIterative(pos, depth) {
	const goal = M.mateGoal(pos.turn, { narrow: true, seed: true });
	for (let d = 1; d <= depth; d++)
		for (const m of M.allMoves(pos)) if (M.solve(goal, after(pos, m), d - 1).refuted) return m;
	return null;
}

const times = [];
const straight = [];
const naive = [];
const found = [];
let done = 0;
for (const p of puzzles(N)) {
	let pos;
	try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const t0 = performance.now();
			let hit = null;
			try { hit = mateSolveProbed(pos, DEPTH); } catch { /* keep the timing */ }
			times.push(performance.now() - t0);
			found.push(hit ? 1 : 0);
			// The two rejected versions, for the comparison the switch needs.
			const t1 = performance.now();
			try { mateSolve(pos, DEPTH); } catch { /* keep the timing */ }
			straight.push(performance.now() - t1);
			const t2 = performance.now();
			try { mateSolveIterative(pos, DEPTH); } catch { /* keep the timing */ }
			naive.push(performance.now() - t2);
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
	if (++done % 100 === 0) process.stderr.write(`  ${done} puzzles, ${times.length} plies\n`);
}

console.log(`\n  ${times.length} solver plies, mate rung only, depth ${DEPTH}\n`);
console.log(`  cost   mean ${mean(times).toFixed(1)}ms   median ${q(times, 0.5).toFixed(1)}ms   p90 ${q(times, 0.9).toFixed(1)}ms   p99 ${q(times, 0.99).toFixed(0)}ms   max ${Math.max(...times).toFixed(0)}ms`);
for (const b of [16, 100, 500]) {
	const n = times.filter((t) => t > b).length;
	console.log(`  over ${String(b).padStart(3)}ms   ${n}/${times.length}  ${((100 * n) / times.length).toFixed(1)}%`);
}
console.log(`\n  straight to depth ${DEPTH} (the version that returns A mate, not THE mate):`);
console.log(`  cost   mean ${mean(straight).toFixed(1)}ms   median ${q(straight, 0.5).toFixed(1)}ms   p90 ${q(straight, 0.9).toFixed(1)}ms   max ${Math.max(...straight).toFixed(0)}ms`);
console.log(`\n  deepening with NO probe (correct, but pays on every position):`);
console.log(`  cost   mean ${mean(naive).toFixed(1)}ms   median ${q(naive, 0.5).toFixed(1)}ms   p90 ${q(naive, 0.9).toFixed(1)}ms   max ${Math.max(...naive).toFixed(0)}ms`);
console.log(`\n  SHIPPED (probe then deepen) is ${(mean(times) / Math.max(0.01, mean(straight))).toFixed(2)}x the wrong-but-fast version`);
console.log(`  and ${(mean(times) / Math.max(0.01, mean(naive))).toFixed(2)}x the unprobed deepening it replaces`);

console.log(`\n  a mate was found on ${found.filter(Boolean).length}/${found.length}  ${((100 * found.filter(Boolean).length) / found.length).toFixed(1)}% of plies`);
console.log(`  (the decoration test: if a forced mate is available everywhere, the wheel is not news)\n`);
process.exit(0);
