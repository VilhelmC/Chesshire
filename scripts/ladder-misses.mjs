// WHERE DOES THE LADDER FAIL? — the profile, before anything is built on top.
//
// Depth 5 leaves 8.9% wrong and 26% tied. "Wrong" is not one thing, and the
// difference matters more than the total, because the three kinds want three
// different fixes and one of them is a soundness bug rather than a gap:
//
//   UNFORCED   the ladder proved nothing and fell through to the bottom rung's
//              opinion. An honest "nothing is forced here" — a MISS, and the
//              cheapest kind to be wrong about.
//
//   OVERSHOT   a rung was proved, and the puzzle's move was not in its answer
//              set. Two sub-cases that must not be conflated:
//                · the answer set is a genuine dual and the corpus lists one
//                · we proved a swing that is not actually forced -> SOUNDNESS
//
//   UNDERSHOT  a rung was proved BELOW the one the puzzle's move achieves. The
//              ladder stopped too early: the exclusion above it was wrong.
//              Also soundness, in the other direction.
//
// A ladder that is merely short-sighted is fine and gets deeper. A ladder that
// proves the wrong thing is broken and gets fixed. This script says which.
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 300);
const DEPTH = Number(process.argv[3] ?? 5);

const M = await load(`export { ladderReport, materialFor, settled, guarantees, allMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

const plies = [];
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1)
			plies.push({ id: p.id, rating: p.rating, pos, want: p.moves[i], themes: p.themes, ply: i });
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}

const bucket = { found: 0, tied: 0, unforced: 0, overshot: 0, undershot: 0 };
const byTheme = {};
const samples = { unforced: [], overshot: [], undershot: [] };
const setSizes = [];
let ms = 0;

for (const s of plies) {
	const t0 = Date.now();
	let r;
	try {
		r = M.ladderReport(s.pos, DEPTH);
	} catch {
		continue;
	}
	ms += Date.now() - t0;
	const hit = r.moves.some((m) => nm(m).slice(0, 4) === s.want.slice(0, 4));

	let kind;
	if (hit) kind = r.moves.length > 1 ? 'tied' : 'found';
	else if (!r.forced) kind = 'unforced';
	else {
		// The rung was proved and our move was not in it. Did the puzzle's move
		// achieve MORE than the rung we settled on? `guarantees` is the same
		// expression the material rungs are read off, so this is the ladder's own
		// measure rather than a second opinion.
		const base = M.materialFor(s.pos.board, s.pos.turn);
		const want = M.allMoves(s.pos).find((m) => nm(m).slice(0, 4) === s.want.slice(0, 4));
		let wantSwing = null;
		if (want) {
			const g = M.guarantees(s.pos, want, s.pos.turn);
			wantSwing = Number.isFinite(g) ? g - base : Infinity;
		}
		const got = r.value === 'mate' ? Infinity : r.value;
		kind = wantSwing !== null && wantSwing > got + 0.5 ? 'undershot' : 'overshot';
		if (samples[kind].length < 12)
			samples[kind].push(
				`${s.id} (${s.rating}) ${s.themes.slice(0, 2).join(',')} — want ${s.want}` +
					` worth ${wantSwing === Infinity ? 'mate' : wantSwing === null ? '?' : wantSwing}` +
					`, we proved ${r.value === 'mate' ? 'MATE' : r.value} via ${r.moves.slice(0, 3).map(nm).join(' ')}` +
					`${r.moves.length > 3 ? ` +${r.moves.length - 3}` : ''}`,
			);
	}
	if (kind === 'unforced' && samples.unforced.length < 12)
		samples.unforced.push(
			`${s.id} (${s.rating}) ${s.themes.slice(0, 2).join(',')} — want ${s.want}, best exchange ${r.value}`,
		);

	bucket[kind]++;
	if (r.forced) setSizes.push(r.moves.length);
	for (const t of s.themes) {
		byTheme[t] ??= { n: 0, bad: 0 };
		byTheme[t].n++;
		if (kind !== 'found' && kind !== 'tied') byTheme[t].bad++;
	}
}

const n = plies.length;
const pc = (x) => `${((100 * x) / n).toFixed(1)}%`;
console.log(`\n  ${n} solver plies over ${N} puzzles, depth ${DEPTH}, ${(ms / n).toFixed(0)}ms/ply\n`);
console.log(`  found      ${String(bucket.found).padStart(5)}  ${pc(bucket.found)}   the answer, alone`);
console.log(`  tied       ${String(bucket.tied).padStart(5)}  ${pc(bucket.tied)}   the answer, with company`);
console.log(`  ─────`);
console.log(`  UNFORCED   ${String(bucket.unforced).padStart(5)}  ${pc(bucket.unforced)}   proved nothing — short-sighted, not wrong`);
console.log(`  OVERSHOT   ${String(bucket.overshot).padStart(5)}  ${pc(bucket.overshot)}   proved a rung, answer not in its set`);
console.log(`  UNDERSHOT  ${String(bucket.undershot).padStart(5)}  ${pc(bucket.undershot)}   stopped BELOW what the answer wins ← soundness`);

console.log(`\n  answer-set size when forced: mean ${mean(setSizes).toFixed(2)}  median ${q(setSizes, 0.5)}  p90 ${q(setSizes, 0.9)}  max ${Math.max(...setSizes)}`);

const themes = Object.entries(byTheme)
	.filter(([, v]) => v.n >= 25)
	.sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n)
	.slice(0, 14);
console.log(`\n  worst themes (n >= 25)`);
for (const [t, v] of themes)
	console.log(`    ${t.padEnd(20)} ${String(v.bad).padStart(4)}/${String(v.n).padEnd(5)} ${((100 * v.bad) / v.n).toFixed(0)}% missed`);

for (const k of ['undershot', 'overshot', 'unforced'])
	if (samples[k].length) console.log(`\n  ${k.toUpperCase()}\n    ${samples[k].join('\n    ')}`);
