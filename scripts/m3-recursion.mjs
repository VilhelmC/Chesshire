// M3 GATE, second half — does the RECURSION work, and is it fast enough?
//
// ---------------------------------------------------------------------------
// The panel's whole design rests on asking again being cheap: no essay, no
// per-ply evaluation, and depth supplied by the reader rather than guessed at.
// If a drill-down is slow, the design is wrong rather than the budget.
//
// This walks what a reader does — explain a move, step into its line, ask "?"
// about the move at ply k, and again from there — three levels deep, and reports
// the cost of each step. The panel's cache is reproduced too, because a reader
// going back up the breadcrumb must pay nothing.
//
// PLAN-EXPLAINER §9.2: 800ms a step, and recursion to depth 3 under a second a
// step at M3's gate.
// ---------------------------------------------------------------------------
import { engine } from './_engine.mjs';
import { load, puzzles, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 12);
const DEPTH = Number(process.argv[3] ?? 12);

const e = await engine();
const M = await load(`export { explain } from './src/domain/explain';
export { applyUci, positionFromFen } from './src/domain/chess';`);

/** `scoreMoves` over the Node engine, plus the panel's cache. */
const cache = new Map();
let engineCalls = 0;
async function scoreMoves(fen, moves) {
	const wanted = new Set(moves);
	const top = await e.analyse(fen, { depth: DEPTH, multipv: 1 });
	engineCalls++;
	const best = top.lines[0]?.pv[0];
	if (best) wanted.add(best);
	const out = [];
	for (const uci of wanted) {
		let san;
		try {
			san = M.applyUci(fen, uci).san;
		} catch {
			continue;
		}
		const r = await e.analyse(fen, { depth: DEPTH, searchmoves: [uci] });
		engineCalls++;
		const l = r.lines[0];
		if (l) out.push({ uci, san, cp: l.cp, loss: 0, pv: l.pv, mate: l.mate });
	}
	out.sort((a, b) => b.cp - a.cp);
	const t = out[0]?.cp ?? 0;
	for (const s of out) s.loss = s.cp - t;
	return out;
}

/** One node of the conversation, cached exactly as the panel caches it. */
async function ask(fen, uci) {
	const key = `${fen}|${uci}`;
	if (cache.has(key)) return { x: cache.get(key), ms: 0, cached: true };
	const t0 = Date.now();
	const options = await scoreMoves(fen, [uci]);
	const x = M.explain(fen, uci, options);
	cache.set(key, x);
	return { x, ms: Date.now() - t0, cached: false };
}

const times = [];
const revisits = [];
let walked = 0;
const trails = [];

for (const p of puzzles(200)) {
	if (walked >= N) break;
	let fen;
	try {
		fen = M.applyUci(p.fen, p.moves[0]).fen;
	} catch {
		continue;
	}
	const want = p.moves[1];
	if (!want) continue;

	const trail = [];
	// Level 1: the move itself.
	let step;
	try {
		step = await ask(fen, want);
	} catch {
		continue;
	}
	times.push(step.ms);
	trail.push(`${step.x.san} ${step.ms}ms`);

	// Levels 2 and 3: drill into the line, as the "?" button does — the move at a
	// ply, from the position BEFORE it.
	let node = step.x;
	for (let level = 2; level <= 3; level++) {
		// Pick a ply worth asking about: a forcing one if there is any, else the
		// second move. This is the reader's own behaviour, not an optimisation.
		const t = node.trace;
		const target = t.moments.find((i) => i > 0) ?? 1;
		const s = node.line.steps[target];
		if (!s) break;
		let deeper;
		try {
			deeper = await ask(s.from, s.uci);
		} catch {
			break;
		}
		times.push(deeper.ms);
		trail.push(`${deeper.x.san} ${deeper.ms}ms`);
		node = deeper.x;
	}

	// Going back up the breadcrumb must be free.
	const again = await ask(fen, want);
	revisits.push(again.ms);

	walked++;
	if (trails.length < 8) trails.push(`${p.id}: ${trail.join('  ▸  ')}`);
}

console.log(`\n  ${walked} conversations, three levels each, depth ${DEPTH}\n`);
console.log(`  a step costs      mean ${mean(times).toFixed(0)}ms   median ${q(times, 0.5)}   p90 ${q(times, 0.9)}   max ${Math.max(...times)}`);
const over = times.filter((t) => t > 1000).length;
console.log(`  under a second    ${times.length - over}/${times.length}  ${((100 * (times.length - over)) / times.length).toFixed(0)}%`);
console.log(`  going back up     ${revisits.every((r) => r === 0) ? 'free — every revisit served from cache' : `NOT FREE: ${revisits.filter((r) => r > 0).length} re-computed`}`);
console.log(`  engine calls      ${engineCalls} for ${cache.size} distinct questions`);
console.log(`\n  ${trails.join('\n  ')}`);

e.quit();
process.exit(0);
