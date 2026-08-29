// M0 GATE — is `searchmoves` the same measurement as MultiPV?
//
// ---------------------------------------------------------------------------
// `go searchmoves a b c` restricts the search to the named moves and scores each,
// which is the backbone of the explainer: one search, N moves, one scale. The
// gate exists because "one scale" is a claim, and this project has twice shipped
// a comparison between two things measured differently.
//
// THE FIRST RUN ALREADY DISAGREED. Startpos, 400ms, MultiPV 3 against searchmoves
// on three named moves:
//
//     MultiPV      e2e4  +40
//     searchmoves  e2e4  +29
//
// Same position, same budget, same move — eleven centipawns apart. So the naive
// form of this gate ("identical to the centipawn") fails, and the interesting
// question is WHY, because the answer decides how the product may use it.
//
// The suspect is `movetime`: a time budget is spread across the root moves the
// engine is considering, so restricting from 20 moves to 3 gives each survivor
// more time and a different answer. If that is the cause, then a FIXED DEPTH
// should agree, and the rule for the product is "never compare a score from one
// call against a score from another".
//
// So the gate runs both ways and reports both. What it must establish:
//
//   1. at fixed depth, the two agree on the moves they share
//   2. the ORDERING agrees — because if the ranking is stable the product is safe
//      even where the absolute numbers are not
//
// AND THE ORDERING METRIC HAS TO BE HONEST. A raw "same ranking" test counts a
// flip between two moves 5cp apart as a disagreement, which is noise wearing a
// disagreement's clothes — the same mistake as scoring a tie between two equal
// moves as a failure. So flips are also counted MATERIAL: pairs the two methods
// order differently AND that at least one of them separates by more than
// GAP centipawns. Those are the ones that would tell a user something wrong.
//
// AND IT NEEDS A FLOOR. "searchmoves disagrees with MultiPV on 4.6% of material
// pairs" means nothing until we know how often MultiPV disagrees with ITSELF —
// the same query, run twice. If the engine's own repeatability is the same
// number, then restricting the move list introduces no error and the gate passes;
// if it is zero, the disagreement is real and caused by the restriction. Same
// control as everywhere else in this project: compare like with like before
// concluding anything about the difference.
// ---------------------------------------------------------------------------
import { engine } from './_engine.mjs';
import { puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 60);
const DEPTH = Number(process.argv[3] ?? 12);
const MOVETIME = Number(process.argv[4] ?? 300);
const K = 4;
/** A ranking flip below this is two methods disagreeing about nothing. */
const GAP = Number(process.argv[5] ?? 50);

const e = await engine();

// Positions straight from the corpus FENs — no domain code involved, so this
// gate tests the engine wrapper and nothing else.
const fens = [];
for (const p of puzzles(N)) {
	fens.push(p.fen);
	if (fens.length >= N) break;
}

const MODES = ['depth', 'movetime', 'repeat'];
const blank = () => Object.fromEntries(MODES.map((m) => [m, 0]));
const rows = { depth: [], movetime: [], repeat: [] };
const orderKept = blank();
const counted = blank();
const worst = { depth: [], movetime: [], repeat: [] };
/** Pairs ordered differently, and how many of those are separated by > GAP. */
const pairs = blank();
const flipped = blank();
const material = blank();

for (const fen of fens) {
	for (const mode of MODES) {
		const budget = mode === 'movetime' ? { movetime: MOVETIME } : { depth: DEPTH };
		let multi, restricted;
		try {
			multi = await e.analyse(fen, { ...budget, multipv: K });
			const moves = multi.lines.map((l) => l.pv[0]).filter(Boolean);
			if (moves.length < 2) continue;
			// THE CONTROL: the same query again, not a restricted one. Whatever this
			// row reports is the floor the other two must be read against.
			restricted =
				mode === 'repeat'
					? await e.analyse(fen, { ...budget, multipv: K })
					: await e.analyse(fen, { ...budget, searchmoves: moves });
		} catch {
			continue;
		}

		// Index both by the root move, which is the only thing they share.
		const a = new Map(multi.lines.map((l) => [l.pv[0], l.cp]));
		const b = new Map(restricted.lines.map((l) => [l.pv[0], l.cp]));
		const shared = [...a.keys()].filter((m) => b.has(m));
		if (shared.length < 2) continue;

		counted[mode]++;
		for (const m of shared) rows[mode].push(Math.abs(a.get(m) - b.get(m)));

		// Ordering: do the two rank the shared moves the same way? This is the
		// property the product actually leans on — "is this move better than that
		// one" survives a scale shift, an absolute score does not.
		// Pairwise, which is where the honest number is: every unordered pair of
		// shared moves, flipped or not, and whether either method thinks they are
		// meaningfully apart.
		for (let i = 0; i < shared.length; i++)
			for (let j = i + 1; j < shared.length; j++) {
				const x = shared[i];
				const y = shared[j];
				const da = a.get(x) - a.get(y);
				const db = b.get(x) - b.get(y);
				pairs[mode]++;
				const flip = Math.sign(da) !== Math.sign(db) && da !== 0 && db !== 0;
				if (flip) {
					flipped[mode]++;
					if (Math.abs(da) > GAP || Math.abs(db) > GAP) material[mode]++;
				}
			}

		const byA = [...shared].sort((x, y) => a.get(y) - a.get(x)).join(' ');
		const byB = [...shared].sort((x, y) => b.get(y) - b.get(x)).join(' ');
		if (byA === byB) orderKept[mode]++;
		else if (worst[mode].length < 6)
			worst[mode].push(
				`${fen.split(' ')[0].slice(0, 24)}…  multipv ${byA}  |  searchmoves ${byB}`,
			);
	}
}

console.log(`\n  ${fens.length} positions, MultiPV ${K} against searchmoves on the same ${K} moves\n`);
for (const mode of MODES) {
	const d = rows[mode];
	const n = counted[mode];
	if (!n) continue;
	const exact = d.filter((x) => x === 0).length;
	console.log(
		`  ${mode === 'depth' ? `searchmoves, go depth ${DEPTH}` : mode === 'movetime' ? `searchmoves, movetime ${MOVETIME}` : `CONTROL: multipv twice, depth ${DEPTH}`}  ` +
			`${String(n).padStart(3)} positions, ${d.length} shared moves\n` +
			`      identical scores   ${String(exact).padStart(4)}/${d.length}  ${((100 * exact) / d.length).toFixed(1)}%\n` +
			`      |difference|       mean ${mean(d).toFixed(1)}cp  median ${q(d, 0.5)}  p90 ${q(d, 0.9)}  max ${Math.max(...d)}\n` +
			`      same full ranking  ${String(orderKept[mode]).padStart(4)}/${n}  ${((100 * orderKept[mode]) / n).toFixed(1)}%\n` +
			`      pairs flipped      ${String(flipped[mode]).padStart(4)}/${pairs[mode]}  ${((100 * flipped[mode]) / pairs[mode]).toFixed(1)}%\n` +
			`      FLIPPED AND >${GAP}cp ${String(material[mode]).padStart(4)}/${pairs[mode]}  ${((100 * material[mode]) / pairs[mode]).toFixed(2)}%   <- would mislead`,
	);
	if (worst[mode].length) console.log(`      disagreements:\n        ${worst[mode].join('\n        ')}`);
	console.log('');
}

e.quit();
process.exit(0);
