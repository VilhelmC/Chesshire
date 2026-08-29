// ARE THE SCORES INSIDE ONE CALL TRUSTWORTHY? — the question the gate exposed.
//
// ---------------------------------------------------------------------------
// `m0-gate.mjs` established two things:
//
//   * the engine is perfectly deterministic at fixed depth — the same query run
//     twice is identical on 151/151 scores and 220/220 pairs
//   * `searchmoves` therefore genuinely DISAGREES with MultiPV: mean 25.8cp, max
//     229cp, and 4.55% of pairs flip by more than 50cp
//
// So restricting the root move list changes the search itself — different root
// ordering, different bounds, different reductions. Neither answer is "wrong";
// they are different searches.
//
// Which leaves the only question the product actually cares about. The explainer
// will always score its comparison set in ONE call, so it never compares across
// calls. But are the scores WITHIN a call mutually consistent?
//
// There is reason to doubt it. In a MultiPV search only the first line gets a
// full window; the rest are searched against bounds derived from it, so their
// scores can be bounds rather than evaluations. If that leaks into `searchmoves`,
// then a single call's internal ranking is not trustworthy either, and the
// fallback is N single-move searches — exact, and N times the cost.
//
// THE GROUND TRUTH is `searchmoves` with ONE move: that move is the only thing at
// the root, so it gets a full-window search and an exact score. Compare each
// move's score in the multi-move call against its own single-move search.
//
//   agree  ->  one call is enough, the 800ms budget holds
//   differ ->  the product needs N calls, and the budget has to be rethought
// ---------------------------------------------------------------------------
import { engine } from './_engine.mjs';
import { puzzles, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 25);
const DEPTH = Number(process.argv[3] ?? 12);
const K = 4;
const GAP = 50;

const e = await engine();

const fens = [];
for (const p of puzzles(N)) fens.push(p.fen);

const diffs = [];
let pairs = 0;
let flipped = 0;
let material = 0;
let positions = 0;
const worst = [];
let msMulti = 0;
let msSingles = 0;

for (const fen of fens) {
	let multi;
	try {
		multi = await e.analyse(fen, { depth: DEPTH, multipv: K });
	} catch {
		continue;
	}
	const moves = multi.lines.map((l) => l.pv[0]).filter(Boolean).slice(0, K);
	if (moves.length < 2) continue;

	// One call, all moves.
	const t0 = Date.now();
	let together;
	try {
		together = await e.analyse(fen, { depth: DEPTH, searchmoves: moves });
	} catch {
		continue;
	}
	msMulti += Date.now() - t0;
	const inCall = new Map(together.lines.map((l) => [l.pv[0], l.cp]));

	// N calls, one move each — the exact score for each.
	const t1 = Date.now();
	const alone = new Map();
	for (const m of moves) {
		try {
			const r = await e.analyse(fen, { depth: DEPTH, searchmoves: [m] });
			const line = r.lines[0];
			if (line) alone.set(m, line.cp);
		} catch {
			/* skip */
		}
	}
	msSingles += Date.now() - t1;

	const shared = moves.filter((m) => inCall.has(m) && alone.has(m));
	if (shared.length < 2) continue;
	positions++;

	for (const m of shared) diffs.push(Math.abs(inCall.get(m) - alone.get(m)));

	for (let i = 0; i < shared.length; i++)
		for (let j = i + 1; j < shared.length; j++) {
			const x = shared[i];
			const y = shared[j];
			const da = inCall.get(x) - inCall.get(y);
			const db = alone.get(x) - alone.get(y);
			pairs++;
			if (Math.sign(da) !== Math.sign(db) && da !== 0 && db !== 0) {
				flipped++;
				if (Math.abs(da) > GAP || Math.abs(db) > GAP) {
					material++;
					if (worst.length < 6)
						worst.push(
							`${fen.split(' ')[0].slice(0, 22)}…  ${x} vs ${y}:  in-call ${da > 0 ? '+' : ''}${da}  alone ${db > 0 ? '+' : ''}${db}`,
						);
				}
			}
		}
}

const exact = diffs.filter((x) => x === 0).length;
console.log(`\n  ${positions} positions, ${diffs.length} moves — one call against one search each\n`);
console.log(`    identical scores    ${String(exact).padStart(4)}/${diffs.length}  ${((100 * exact) / diffs.length).toFixed(1)}%`);
console.log(`    |difference|        mean ${mean(diffs).toFixed(1)}cp  median ${q(diffs, 0.5)}  p90 ${q(diffs, 0.9)}  max ${Math.max(...diffs)}`);
console.log(`    pairs flipped       ${String(flipped).padStart(4)}/${pairs}  ${((100 * flipped) / pairs).toFixed(1)}%`);
console.log(`    FLIPPED AND >${GAP}cp  ${String(material).padStart(4)}/${pairs}  ${((100 * material) / pairs).toFixed(2)}%`);
console.log(`\n    cost   one call ${(msMulti / positions).toFixed(0)}ms   ${K} calls ${(msSingles / positions).toFixed(0)}ms   ${(msSingles / Math.max(1, msMulti)).toFixed(1)}x`);
if (worst.length) console.log(`\n  ${worst.join('\n  ')}`);

e.quit();
process.exit(0);
