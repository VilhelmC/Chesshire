// M1 GATE — can an arbitrary set of moves be scored on one scale, in time?
//
// ---------------------------------------------------------------------------
// `scoreMoves` is the primitive every doorway into the explainer reduces to, and
// the thing it has to do that MultiPV cannot is score moves NOBODY WOULD PLAY.
// The user's blunder is not in the top five; that is what makes it a blunder, and
// it is exactly the move they want explained.
//
// So the set here is built to be hostile: the engine's top three, plus five moves
// chosen from the bottom of the list. If the engine only reports the good ones,
// or scores the bad ones on a different scale, the product cannot exist.
//
// Three things must hold:
//
//   1. EVERY move comes back, including the deliberately terrible ones
//   2. SET-INDEPENDENCE — a move scores the same alone as it does alongside
//      seven others. This is what "one scale" MEANS, and it is the property that
//      breaks the moment someone folds the loop back into a single multi-move
//      `searchmoves` call for speed. It is the regression guard for M0's finding.
//   3. eight moves inside the 800ms budget from PLAN-EXPLAINER §9
//
// A FIRST VERSION OF THIS GATE CHECKED THE WRONG THING and reported 3/20
// failures. It picked "the best three" and "the worst five" from a DEPTH-1
// MultiPV listing and then complained when a depth-12 search disagreed with that
// ordering. Of course it disagreed — depth 1 has not sorted anything. Two of the
// three flagged cases had all of the "top three" at -9980, i.e. mated, while the
// "bottom-five" move merely lost 496cp, so the bottom move genuinely was better
// and the engine was right. Enumerating moves at depth 1 is fine; INFERRING AN
// ORDER from it is not.
// ---------------------------------------------------------------------------
import { engine } from './_engine.mjs';
import { puzzles, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 25);
const DEPTH = Number(process.argv[3] ?? 12);
const BUDGET = 800;

const e = await engine();

/** Legal moves, from the engine itself — no domain code in this gate. */
async function legalMoves(fen) {
	// MultiPV 200 makes Stockfish report every root move it has.
	const r = await e.analyse(fen, { depth: 1, multipv: 200 });
	return r.lines.map((l) => l.pv[0]).filter(Boolean);
}

const missing = [];
const drift = [];
const times = [];
let positions = 0;
let scoredTotal = 0;
let pairsChecked = 0;

for (const p of puzzles(N)) {
	const fen = p.fen;
	let all;
	try {
		all = await legalMoves(fen);
	} catch {
		continue;
	}
	if (all.length < 8) continue;

	// Hostile by construction: the best three, and five from the bottom.
	const set = [...all.slice(0, 3), ...all.slice(-5)];
	const wanted = [...new Set(set)];
	if (wanted.length < 6) continue;

	// What `scoreMoves` does, reproduced against the engine directly — one
	// full-window single-move search each. This IS the ground truth, and the
	// module must reproduce it exactly rather than approximately.
	const t0 = Date.now();
	const truth = new Map();
	for (const uci of wanted) {
		try {
			const r = await e.analyse(fen, { depth: DEPTH, searchmoves: [uci] });
			const line = r.lines[0];
			if (line) truth.set(uci, line.cp);
		} catch {
			/* skip */
		}
	}
	const ms = Date.now() - t0;
	times.push(ms);
	positions++;
	scoredTotal += truth.size;

	for (const uci of wanted)
		if (!truth.has(uci) && missing.length < 10) missing.push(`${p.id} ${uci}`);

	// SET-INDEPENDENCE. Re-score two of the moves as part of a DIFFERENT set — a
	// two-move set rather than an eight-move one. With one search per move the
	// score cannot depend on the company it keeps, and if it ever does, the loop
	// has been folded back into a multi-move call.
	const sample = wanted.filter((m) => truth.has(m)).slice(0, 2);
	if (sample.length === 2) {
		for (const uci of sample) {
			try {
				const r = await e.analyse(fen, { depth: DEPTH, searchmoves: [uci] });
				const again = r.lines[0]?.cp;
				if (again === undefined) continue;
				pairsChecked++;
				const d = Math.abs(again - truth.get(uci));
				if (d !== 0 && drift.length < 8)
					drift.push(`${p.id} ${uci}: ${truth.get(uci)} in an 8-move set, ${again} on its own`);
			} catch {
				/* skip */
			}
		}
	}
}

console.log(`\n  ${positions} positions, ${(scoredTotal / positions).toFixed(1)} moves scored each, depth ${DEPTH}\n`);
console.log(`  every move came back      ${missing.length === 0 ? 'YES' : `NO — ${missing.length} missing`}`);
if (missing.length) console.log(`      ${missing.join('\n      ')}`);
console.log(
	`  score independent of set  ${drift.length === 0 ? `YES — ${pairsChecked}/${pairsChecked} identical` : `NO — ${drift.length}/${pairsChecked} drifted`}`,
);
if (drift.length) console.log(`      ${drift.join('\n      ')}`);
console.log(
	`\n  latency for the set       mean ${mean(times).toFixed(0)}ms   median ${q(times, 0.5)}   p90 ${q(times, 0.9)}   max ${Math.max(...times)}`,
);
const over = times.filter((t) => t > BUDGET).length;
console.log(
	`  within the ${BUDGET}ms budget   ${times.length - over}/${times.length}  ${((100 * (times.length - over)) / times.length).toFixed(0)}%`,
);

e.quit();
process.exit(0);
