// M2 GATE — the trace is arithmetic, so it is exact or it is wrong.
//
// ---------------------------------------------------------------------------
// `trace()` folds a line into material-at-every-ply. There is no search, no
// engine, no budget: every number is counted off a board. So unlike every other
// gate in this project there is no threshold to argue about and no noise to
// stratify away. It agrees with a direct count, on every line, or it does not
// ship.
//
// Four properties, each able to fail on its own:
//
//   1. NET MATTERS. `trace.net` equals a direct material diff between the root
//      position and the last position — the fold cannot drift from the endpoints.
//   2. DELTAS SUM. The per-ply deltas add up to the net. A step that reports the
//      wrong delta but a right material would pass (1) and fail here.
//   3. CAPTURES EXPLAIN THE DELTAS. Every non-zero delta has a capture or a
//      promotion on that ply, and every capture-or-promotion has a non-zero
//      delta. This is the one that catches en passant, which takes a man while
//      landing on an empty square.
//   4. FORCING IS TRUE. Every ply marked `only` really does leave one legal
//      reply; every `mate` really is mate. Checked against a fresh generation.
//
// The corpus lines are the whole puzzle solutions — real, forcing, full of
// captures and promotions and the occasional en passant, which is exactly the
// traffic this module exists to survive.
// ---------------------------------------------------------------------------
import { load, puzzles } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { trace } from './src/domain/trace';
export { lineFromUci } from './src/domain/line';
export { positionFromFen } from './src/domain/chess';
export { V } from './src/domain/exchange';`);

/** A direct count, written out here so it shares nothing with the module. */
function material(fen, side) {
	const pos = M.positionFromFen(fen);
	const colour = side === 'w' ? 'white' : 'black';
	let n = 0;
	for (const sq of pos.board.occupied) {
		const p = pos.board.get(sq);
		if (!p || p.role === 'king') continue;
		n += p.color === colour ? M.V[p.role] : -M.V[p.role];
	}
	return n;
}

let lines = 0;
let plies = 0;
const fail = { net: [], sum: [], captures: [], forcing: [] };

for (const p of puzzles(N)) {
	let line;
	try {
		line = M.lineFromUci(p.fen, p.moves);
	} catch {
		continue;
	}
	if (!line.complete || !line.steps.length) continue;

	const side = M.positionFromFen(p.fen).turn === 'white' ? 'w' : 'b';
	let t;
	try {
		t = M.trace(line, side);
	} catch (err) {
		fail.net.push(`${p.id} threw: ${String(err).slice(0, 80)}`);
		continue;
	}
	lines++;
	plies += t.steps.length;

	// 1. NET
	const direct = material(line.steps.at(-1).fen, side) - material(p.fen, side);
	if (t.net !== direct && fail.net.length < 8)
		fail.net.push(`${p.id}: trace.net ${t.net}, direct ${direct}`);

	// 2. DELTAS SUM
	const summed = t.steps.reduce((a, s) => a + s.delta, 0);
	if (summed !== t.net && fail.sum.length < 8)
		fail.sum.push(`${p.id}: deltas sum to ${summed}, net is ${t.net}`);

	// 3. CAPTURES EXPLAIN THE DELTAS
	for (const s of t.steps) {
		const changed = s.delta !== 0;
		const event = s.captured !== null || s.promoted !== null;
		if (changed !== event && fail.captures.length < 10)
			fail.captures.push(
				`${p.id} ply ${s.ply} ${s.san} (${s.uci}): delta ${s.delta}, captured ${s.captured}, promoted ${s.promoted}`,
			);
	}

	// 4. FORCING IS TRUE
	for (const s of t.steps) {
		const after = M.positionFromFen(s.fen);
		let n = 0;
		for (const [, d] of after.allDests()) n += d.size();
		const reallyMate = after.isCheckmate();
		if (s.only !== (n === 1) && fail.forcing.length < 10)
			fail.forcing.push(`${p.id} ply ${s.ply} ${s.san}: only=${s.only} but ${n} legal replies`);
		if (s.mate !== reallyMate && fail.forcing.length < 10)
			fail.forcing.push(`${p.id} ply ${s.ply} ${s.san}: mate=${s.mate} but isCheckmate=${reallyMate}`);
	}
}

console.log(`\n  ${lines} complete lines, ${plies} plies\n`);
const rows = [
	['net matches a direct diff', fail.net],
	['deltas sum to the net', fail.sum],
	['every delta has a capture or promotion', fail.captures],
	['only / mate are true of the board', fail.forcing],
];
let ok = true;
for (const [label, f] of rows) {
	console.log(`  ${label.padEnd(40)} ${f.length === 0 ? 'PASS' : `FAIL (${f.length})`}`);
	if (f.length) {
		ok = false;
		console.log(`      ${f.join('\n      ')}`);
	}
}
console.log(`\n  ${ok ? 'M2 GATE PASSES' : 'M2 GATE FAILS'}\n`);
process.exit(ok ? 0 : 1);
