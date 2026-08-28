// WHY DOES THE LADDER TIE? — and first, whether tying is even wrong.
//
// ---------------------------------------------------------------------------
// 624 of 2656 solver plies (23.5%) come back with several moves and no way to
// choose. As a trainer that reads as "no opinion", which is why it matters more
// than the 7.2% that are wrong.
//
// But the first question is not how to break them. It is:
//
//     HOW MANY OF THESE TIES ARE RIGHT?
//
// Lichess lists ONE solution per puzzle. Plenty of positions have several moves
// that win exactly the same thing, and when the ladder names all of them it is
// being correct and the corpus is being under-specified. Counting those as
// failures measures the corpus, not the solver — which is the standing warning in
// WHERE-NEXT.md §5, and it cost this project a script's worth of fiction the last
// time it was skipped.
//
// So every tie is put to a referee that did not produce it: `holds(4)`, two plies
// deeper than the value the tie came from. Three outcomes, and they want three
// different responses:
//
//   DUAL        every tied move is still equal at depth 4. The ladder is right.
//               Nothing to fix; the corpus cannot tell us which one it meant.
//
//   SEPARABLE   depth 4 splits them AND puts the puzzle's move on top. A real
//               failure to discriminate, and one that depth would fix — so the
//               question becomes price, not mechanism.
//
//   WRONG-TOP   depth 4 splits them and prefers something else. Neither the
//               shallow tie nor the deeper search agrees with the corpus, which
//               points at the evaluation rather than at the horizon.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 150);
const CAP = Number(process.argv[3] ?? 60);

const M = await load(`export { ladderReport, holds, materialFor, allMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

const ties = [];
const sizes = [];
let plies = 0;
let found = 0;

for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			plies++;
			let r;
			try {
				r = M.ladderReport(pos, 5);
			} catch {
				r = null;
			}
			if (r) {
				const hit = r.moves.some((m) => nm(m).slice(0, 4) === p.moves[i].slice(0, 4));
				if (hit && r.moves.length > 1) {
					sizes.push(r.moves.length);
					if (ties.length < CAP)
						ties.push({ id: p.id, rating: p.rating, pos, want: p.moves[i], themes: p.themes, r });
				} else if (hit) found++;
			}
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (ties.length >= CAP && sizes.length > 200) break;
}

console.log(`\n  ${plies} solver plies · ${found} found alone · ${sizes.length} tied`);
console.log(`  tie size: mean ${mean(sizes).toFixed(2)}  median ${q(sizes, 0.5)}  p90 ${q(sizes, 0.9)}  max ${Math.max(...sizes)}`);
const hist = {};
for (const s of sizes) hist[Math.min(s, 6)] = (hist[Math.min(s, 6)] ?? 0) + 1;
console.log(
	`  ${Object.entries(hist)
		.sort((a, b) => a[0] - b[0])
		.map(([k, v]) => `${k === '6' ? '6+' : k} moves: ${v}`)
		.join('   ')}`,
);

// ---------------------------------------------------------------------------
const bucket = { dual: 0, separable: 0, wrongTop: 0 };
const byRung = {};
const samples = { dual: [], separable: [], wrongTop: [] };
let ms = 0;

for (const t of ties) {
	const att = t.pos.turn;
	const t0 = Date.now();
	// Every tied move, at depth 4, FULL WINDOW — no alpha carried between them,
	// because a running alpha would prune exactly the comparison being made.
	const scored = t.r.moves.map((m) => ({ m, v: M.holds(t.pos, m, att, 4, -Infinity, Infinity) }));
	ms += Date.now() - t0;
	let best = -Infinity;
	for (const s of scored) if (s.v > best) best = s.v;
	const top = scored.filter((s) => s.v > best - 0.5);
	const wantIsTop = top.some((s) => nm(s.m).slice(0, 4) === t.want.slice(0, 4));

	const rung = t.r.value === 'mate' ? 'mate' : String(t.r.value);
	byRung[rung] ??= { n: 0, dual: 0 };
	byRung[rung].n++;

	let kind;
	if (top.length === scored.length) {
		kind = 'dual';
		byRung[rung].dual++;
	} else kind = wantIsTop ? 'separable' : 'wrongTop';
	bucket[kind]++;
	if (samples[kind].length < 8)
		samples[kind].push(
			`${t.id} (${t.rating}) ${t.themes.slice(0, 2).join(',').padEnd(22)} want ${t.want}` +
				`  rung ${rung}  tied ${scored.length}` +
				(kind === 'dual' ? '' : `  d4 top ${top.map((s) => nm(s.m)).join(' ')}`),
		);
}

const n = ties.length;
console.log(`\n  ${n} ties refereed at depth 4, ${(ms / n).toFixed(0)}ms each\n`);
for (const [k, label] of [
	['dual', 'DUAL       every tied move still equal — the ladder is RIGHT'],
	['separable', 'SEPARABLE  depth splits them and prefers the answer'],
	['wrongTop', 'WRONG-TOP  depth splits them and prefers something else'],
])
	console.log(`  ${label.padEnd(58)} ${String(bucket[k]).padStart(4)}  ${((100 * bucket[k]) / n).toFixed(1)}%`);

console.log(`\n  by the rung that answered`);
for (const [k, v] of Object.entries(byRung).sort((a, b) => b[1].n - a[1].n))
	console.log(`    ${k.padStart(6)}  ${String(v.n).padStart(4)} ties, ${((100 * v.dual) / v.n).toFixed(0)}% genuine duals`);

for (const k of ['separable', 'wrongTop', 'dual'])
	if (samples[k].length) console.log(`\n  ${k.toUpperCase()}\n    ${samples[k].join('\n    ')}`);
