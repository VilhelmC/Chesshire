// M5 GATE — mobilization deficiency, FALSIFIED rather than scored.
//
// ---------------------------------------------------------------------------
// There is no `mobilization` theme, so there is no precision to compute, and
// inventing one would be worse than having none. What there IS, is a corpus of
// verified winning lines — and a claim that CONTRADICTS a verified winning line
// is wrong, with no interpretation needed.
//
// THE FALSIFIER. `deficiencies()` says: this square cannot be won, however many
// men you send, out to the horizon. So take every solver ply where the corpus's
// own answer CAPTURES on a square and the solution nets material, and ask
// whether the detector had called that square deficient. Every hit is the
// detector telling a learner not to do the thing that wins.
//
// The sacrifice split is not a let-off, it is the actual distinction. A puzzle
// themed `sacrifice` wins by giving material away on that square, so "this
// square is not worth winning" is TRUE there and the capture is not a
// counterexample — the material comes from somewhere else. Reported separately
// so the number cannot be quietly improved by folding them in.
//
// Three other things are measured, because a detector that is never wrong and
// never fires is not a detector:
//
//   FIRING RATE   the decoration test. A deficiency on every square is a
//                 statement about chess.
//   COST          it walks every man to every contested square, which is the
//                 most expensive thing on §4's list by a distance. The budget is
//                 the overlay's: one frame, drawn once per position.
//   THE OTHER HALF `worthMobilising` — squares that do NOT pay now and DO with
//                 more men. If that set is empty the horizon is doing nothing
//                 and the whole primitive reduces to SEE, which already exists.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 400);
const HORIZON = Number(process.argv[3] ?? 3);

const M = await load(`export { deficiencies, worthMobilising, muster, swap } from './src/domain/primitives/muster';
export { moves } from './src/domain/primitives/core';
export { trace } from './src/domain/trace';
export { lineFromUci } from './src/domain/line';
export { positionFromFen, fenOf, applyUci } from './src/domain/chess';
export { materialFor } from './src/domain/ladder';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

let plies = 0;
let fired = 0;
let deficientSquares = 0;
let contested = 0;
const times = [];
const worth = [];
const arrivals = [0, 0, 0, 0, 0, 0, 0];
const byPrize = [];

let capturesChecked = 0;
const falsified = [];
const sacrificed = [];
const unknown = [];

let done = 0;
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	// The whole solution's material outcome, from the mover's point of view at the
	// first solver ply. `trace` is M2's and is exact arithmetic on the board.
	// `trace` takes a Line and an optional mover, NOT a uci array and a fen — the
	// first version of this script passed the wrong things, the call threw, every
	// net came back 0, and the `net <= 0` branch swallowed all 334 falsifications
	// as "sacrifices". A gate that classifies everything into the harmless bucket
	// is not reporting a good result, it is reporting a broken one.
	let net = null;
	try {
		const rest = p.moves.slice(1);
		if (rest.length) {
			const start = M.applyUci(p.fen, p.moves[0]).fen;
			net = M.trace(M.lineFromUci(start, rest)).net;
		}
	} catch {
		net = null;
	}

	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const answer = p.moves[i];
			let defs = [];
			try {
				const t0 = performance.now();
				defs = M.deficiencies(pos, HORIZON);
				times.push(performance.now() - t0);
				worth.push(M.worthMobilising(pos, HORIZON).length);
				for (const d of defs) for (const a of [...d.ours, ...d.theirs]) if (a.at <= 6) arrivals[a.at]++;
				byPrize.push(defs.map((d) => d.prize));
			} catch {
				continue;
			}
			plies++;
			if (defs.length) fired++;
			deficientSquares += defs.length;

			// THE FALSIFIER. The answer captures on a square; the detector said that
			// square could not be won.
			const mv = M.moves(pos).find((m) => same(m, answer));
			const victim = mv && pos.board.get(mv.to);
			if (mv && victim && victim.color !== pos.turn) {
				contested++;
				const claimed = defs.find((d) => d.square === mv.to);
				if (claimed) {
					capturesChecked++;
					const row = {
						id: p.id,
						uci: answer,
						square: M.makeSquare(mv.to),
						net,
						themes: p.themes.slice(0, 3).join(' '),
						fen: M.fenOf(pos),
					};
					// ATTRIBUTE THE MATERIAL TO THE SQUARE, NOT TO THE LINE.
					//
					// The first falsifier credited the WHOLE solution's net to whichever square
					// the answer happened to capture on, and so counted an even trade followed
					// by a winning intermezzo as a contradiction. It is not one: "d4 cannot be
					// won" is TRUE when Nxd4 Qxd4 is an even trade, and the +3.30 arrives from
					// somewhere else entirely (`Gus3T`, themed `intermezzo`).
					//
					// The local reading instead: play the answer and the opponent's ACTUAL reply,
					// and compare material. That, and only that, is what "the square was won"
					// means. A sacrifice comes out <= 0 here by construction, so it needs no
					// theme check and cannot be used as an escape hatch.
					const before = M.materialFor(pos.board, pos.turn);
					let local = null;
					try {
						const child = pos.clone();
						child.play(mv);
						const reply = p.moves[i + 1];
						if (reply) child.play(M.moves(child).find((m) => same(m, reply)));
						local = M.materialFor(child.board, pos.turn) - before;
					} catch {
						local = null;
					}
					row.local = local;
					if (local === null) unknown.push(row);
					else if (local > 0) falsified.push(row);
					else sacrificed.push(row);
				}
			}
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (++done % 100 === 0) process.stderr.write(`  ${done} puzzles, ${plies} plies\n`);
}

console.log(`\n  ${plies} solver plies from ${done} puzzles, horizon ${HORIZON}\n`);

console.log(`  ── the falsifier ──\n`);
console.log(`    answers that capture       ${contested}`);
console.log(`    on a square called deficient ${capturesChecked}`);
console.log(
	`    FALSIFIED                  ${falsified.length}  ${((100 * falsified.length) / Math.max(1, contested)).toFixed(2)}% of capturing answers`,
);
console.log(`    even or worse at the square ${sacrificed.length}  (not counterexamples — the claim agrees with them)`);
console.log(`    of which untraceable       ${unknown.length}  (no verdict either way; NOT counted as harmless)`);
if (falsified.length) {
	console.log(`\n    the contradictions, worst first:`);
	for (const f of falsified.sort((a, b) => b.local - a.local).slice(0, 10))
		console.log(`      ${f.id}  ${f.uci} on ${f.square}  WON ${(f.local / 100).toFixed(2)} AT THE SQUARE (line ${(f.net / 100).toFixed(2)})   ${f.themes}\n        ${f.fen}`);
}

console.log(`\n  ── the decoration test ──\n`);
console.log(`    fires on                   ${fired}/${plies}  ${((100 * fired) / Math.max(1, plies)).toFixed(1)}% of plies`);
console.log(`    deficient squares          ${(deficientSquares / Math.max(1, plies)).toFixed(2)} per position`);

// IS `bear` FINDING ROUTES AT ALL? If every arrival is at time 0, the horizon is
// vacuous for a mechanical reason and the primitive is SEE wearing a hat — which
// is a bug to find here rather than a finding to write up.
// DOES A NARROWER FORM ESCAPE THE THRESHOLD? PLAN-EXPLAINER §4: "an overlay that
// fires on 40% of quiet positions is a decoration, not a detector." A deficiency
// on a defended pawn is true and worthless; the question is whether restricting
// the prize to something worth wanting leaves a detector or leaves nothing.
console.log(`\n  ── the decoration test, by what is at stake ──\n`);
for (const [name, min] of [['any prize', 0], ['knight or better', 300], ['rook or better', 500], ['a queen', 900]]) {
	const n = byPrize.filter((row) => row.some((v) => v >= min)).length;
	const per = mean(byPrize.map((row) => row.filter((v) => v >= min).length));
	console.log(`    ${name.padEnd(18)} fires on ${((100 * n) / Math.max(1, byPrize.length)).toFixed(1).padStart(5)}% of plies   ${per.toFixed(2)} squares per position`);
}

console.log(`\n  ── do men actually ARRIVE? ──\n`);
const total = arrivals.reduce((s, x) => s + x, 0);
console.log(`    arrivals by ply   ${arrivals.map((n, t) => `t=${t}: ${n} (${((100 * n) / Math.max(1, total)).toFixed(1)}%)`).join('   ')}`);
console.log(`    (all at t=0 would mean \`bear\` found no routes and the horizon is a no-op)`);

console.log(`\n  ── is the HORIZON doing anything? ──\n`);
const anyWorth = worth.filter((w) => w > 0).length;
console.log(`    squares that pay only with more men   ${(mean(worth)).toFixed(2)} per position`);
console.log(`    positions with at least one           ${anyWorth}/${worth.length}  ${((100 * anyWorth) / Math.max(1, worth.length)).toFixed(1)}%`);
console.log(`    (if this is zero the primitive reduces to SEE, which already exists)`);

console.log(`\n  ── cost ──\n`);
console.log(
	`    per position               mean ${mean(times).toFixed(1)}ms   median ${q(times, 0.5).toFixed(1)}ms   p90 ${q(times, 0.9).toFixed(1)}ms   max ${Math.max(...times).toFixed(0)}ms`,
);
const slow = times.filter((t) => t > 16).length;
console.log(`    over one frame (16ms)      ${slow}/${times.length}  ${((100 * slow) / Math.max(1, times.length)).toFixed(1)}%`);
console.log(`    over 100ms                 ${times.filter((t) => t > 100).length}/${times.length}`);

console.log(`\n  This overlay ships on being NEVER WRONG and sometimes useful. A`);
console.log(`  percentage against a theme it does not have would be a worse number\n  than none.\n`);
process.exit(0);
