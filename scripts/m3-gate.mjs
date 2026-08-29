// M3 GATE — read the explanations and check they are TRUE OR SILENT.
//
// ---------------------------------------------------------------------------
// The explainer has no ground truth (PLAN-EXPLAINER §9.1), so this gate cannot
// be a percentage. It prints what the panel will say, for hand-reading, exactly
// as `ladder-report.mjs` did for the LadderPanel — reading the output is the
// gate, and the script's job is to make every claim checkable at a glance.
//
// What is being looked for, in order of seriousness:
//
//   1. A NUMBER FOR THE POSITIONAL PART. There must not be one, anywhere. The
//      `positional` case carries no field that could hold it, so this is really a
//      check that the type held.
//   2. A MATERIAL CLAIM THE LINE DOES NOT SUPPORT. Every `material` verdict names
//      a piece and a ply; the line is printed beside it so the claim can be read
//      against the moves that produce it.
//   3. A MATE CLAIM THAT IS NOT MATE. Printed with the distance so it can be
//      counted.
//   4. Silence where silence is right — a move that is simply best should produce
//      no story at all.
//
// The engine runs in Node (`_engine.mjs`), so `compare.ts` cannot be used
// directly — it imports `cloudEval`, which needs a browser. `scoreMoves` is
// reproduced here over the Node engine, one full-window search per move, which is
// the same computation by construction.
// ---------------------------------------------------------------------------
import { engine } from './_engine.mjs';
import { load, puzzles, play } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 10);
const DEPTH = Number(process.argv[3] ?? 12);

const e = await engine();
const M = await load(`export { explain, shortlist } from './src/domain/explain';
export { positionFromFen, applyUci } from './src/domain/chess';`);

const pawns = (cp) => `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;
const MATE = (cp) => Math.abs(cp) >= 9000;
const showCp = (cp) => (MATE(cp) ? `#${Math.round((10000 - Math.abs(cp)) / 10)}${cp < 0 ? ' against' : ''}` : pawns(cp));

/** `scoreMoves`, over the Node engine. One full-window search per move — M0. */
async function scoreMoves(fen, moves) {
	const stm = fen.split(' ')[1] === 'b' ? 'b' : 'w';
	const wanted = new Set(moves);
	const top = await e.analyse(fen, { depth: DEPTH, multipv: 1 });
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
		const l = r.lines[0];
		if (!l) continue;
		// The Node engine reports side-to-move relative, which is already the
		// mover's point of view — no conversion, unlike the browser path which
		// stores White's.
		out.push({ uci, san, cp: l.cp, loss: 0, pv: l.pv, mate: l.mate });
	}
	out.sort((a, b) => b.cp - a.cp);
	const topCp = out[0]?.cp ?? 0;
	for (const s of out) s.loss = s.cp - topCp;
	return out;
}

function sentence(x) {
	const v = x.verdict;
	const b = v.because;
	if (v.kind === 'best') return 'the best move here';
	if (v.kind === 'equal') return `as good as ${x.best?.san ?? 'the best'} (${pawns(v.loss)})`;
	// The centipawn gap is printed ONLY when it is a centipawn quantity. Against a
	// mate it is not, and `because` carries the real sentence.
	const lead = v.comparable
		? `${v.kind} — ${pawns(v.loss)} against ${x.best?.san ?? '?'}`
		: `${v.kind} against ${x.best?.san ?? '?'}`;
	if (!b) return lead;
	switch (b.kind) {
		case 'mateAgainst':
			return `${lead}: it walks into mate in ${b.in}`;
		case 'missedMate':
			return `${lead}: ${x.best?.san} mates in ${b.in}, this does not`;
		case 'material':
			return (
				`${lead}: in this line ` +
				(b.event === 'promoted'
					? `they promote${b.piece ? ` to a ${b.piece}` : ''}`
					: b.piece
						? `your ${b.piece} goes`
						: 'material goes') +
				` at ply ${b.ply + 1}, ${pawns(b.net)} on the line`
			);
		case 'positional':
			return `${lead}: MATERIAL IS LEVEL — the difference is positional`;
	}
}

let printed = 0;
const suspicious = [];

for (const p of puzzles(200)) {
	if (printed >= N) break;
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	// The position the solver faces, and the move the player is asked about.
	let fen;
	try {
		fen = M.applyUci(p.fen, p.moves[0]).fen;
	} catch {
		continue;
	}
	const want = p.moves[1];
	if (!want) continue;

	// A deliberately mixed comparison set: the puzzle's answer, plus two moves
	// from the bottom of the list so at least one explanation is about a bad move.
	const all = (await e.analyse(fen, { depth: 1, multipv: 200 })).lines.map((l) => l.pv[0]).filter(Boolean);
	if (all.length < 4) continue;
	const set = [...new Set([want, all.at(-1), all.at(-2)])];

	let options;
	try {
		options = await scoreMoves(fen, set);
	} catch {
		continue;
	}
	if (!options.length) continue;
	printed++;

	console.log(`\n${'═'.repeat(76)}`);
	console.log(`${p.id} (${p.rating})  ${p.themes.slice(0, 3).join(' ')}`);
	console.log(`  ${fen}`);
	console.log(`  options:  ${M.shortlist(options, want).map((o) => `${o.san} ${showCp(o.cp)}`).join('   ')}`);

	for (const uci of set) {
		const x = M.explain(fen, uci, options);
		if (!x.self) continue;
		const isAnswer = uci === want;
		console.log(`\n  ${isAnswer ? '★' : ' '} ${x.san.padEnd(8)} ${sentence(x)}`);
		const steps = x.trace.steps
			.map((s) => {
				const marks = [s.check ? '+' : '', s.mate ? '#' : '', s.only ? '!' : ''].join('');
				return `${s.san}${marks}${s.delta ? `(${pawns(s.delta)})` : ''}`;
			})
			.join(' ');
		console.log(`     line:  ${steps || '(none)'}`);
		console.log(`     net ${pawns(x.trace.net)}   moments ${JSON.stringify(x.trace.moments)}   complete ${x.line.complete}`);

		// Automated half of the gate: things that are wrong on their face.
		const v = x.verdict;
		if (v.because?.kind === 'positional' && Math.abs(x.trace.net) >= 100)
			suspicious.push(`${p.id} ${x.san}: called positional but the line moves ${pawns(x.trace.net)}`);
		if (v.because?.kind === 'material' && x.trace.net > -100)
			suspicious.push(`${p.id} ${x.san}: material verdict with net ${pawns(x.trace.net)}`);
		if (v.because?.kind === 'mateAgainst' && !x.trace.steps.some((s) => s.mate) && x.line.complete)
			suspicious.push(`${p.id} ${x.san}: claims mate against, no mate in the line`);
		if (v.kind === 'best' && v.because) suspicious.push(`${p.id} ${x.san}: best move with a story attached`);
		if (v.because?.kind === 'positional' && Object.keys(v.because).length > 1)
			suspicious.push(`${p.id} ${x.san}: positional verdict carries a number`);
		if (!v.comparable && v.kind !== 'best' && !v.because)
			suspicious.push(`${p.id} ${x.san}: incomparable and no reason given`);
	}
}

console.log(`\n${'═'.repeat(76)}`);
console.log(`\n  ${printed} positions explained`);
console.log(`  automated checks: ${suspicious.length === 0 ? 'nothing suspicious' : `${suspicious.length} to look at`}`);
if (suspicious.length) console.log(`    ${suspicious.join('\n    ')}`);

e.quit();
process.exit(0);
