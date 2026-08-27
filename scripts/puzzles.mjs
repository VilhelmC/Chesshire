// Does the detector find the move? DETECTOR §9.
//
// ---------------------------------------------------------------------------
// The ground truth is not mine. Each row of data/puzzle_sample.csv is a position
// plus the opponent's blunder plus the solution, curated by Lichess from real
// games. Two tests come out of every row:
//
//   FIND     — after the blunder, is the puzzle's move among the moves the
//              detector rates best? Roughly 30 legal moves, so a detector that
//              always shouts "tactic" scores about 3%.
//   EXPLAIN  — the blunder itself should show `created > 0` in the §5
//              decomposition: it put something at risk that was safe.
//
// Reported per theme and per rating band, because the useful output is a map of
// what the formalism reaches — not a single number.
//
// Usage: node scripts/puzzles.mjs [limit] [themeFilter]
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 2000);
const DEPTH = Number(process.argv[3] ?? 1);
const ONLY = process.argv[4] ?? null;

// Compile the app's own domain code; reimplementing it here would test the
// reimplementation.
const dir = mkdtempSync(join(tmpdir(), 'puz-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { cover, obligations, harvest, gainOf, candidates } from ${JSON.stringify(join(process.cwd(), 'src/domain/tactics.ts'))};
	 export { V, other } from ${JSON.stringify(join(process.cwd(), 'src/domain/exchange.ts'))};
	 export { bestMoves as searchBest, bestMovesChecked, scoreMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { cover, harvest, gainOf, candidates, obligations, searchBest, bestMovesChecked, V, other, positionFromFen, parseSquare, makeSquare } =
	await import(outfile);

const uci = (m) => `${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? m.promotion[0] === 'k' ? 'n' : m.promotion[0] : ''}`;

function play(pos, u) {
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	const next = pos.clone();
	next.play(promo ? { from, to, promotion: promo } : { from, to });
	return next;
}

/** cost(m) = what they take next, less what m won. DETECTOR §5. */
function costOf(pos, m) {
	const after = pos.clone();
	try {
		after.play(m);
	} catch {
		return Infinity;
	}
	return harvest(after).value - gainOf(pos, m);
}

/** Every move attaining the minimum cost — the argmin SET, not one move. */
function bestMoves(pos) {
	const E = obligations(pos.board, pos.turn, pos.isCheck());
	const pool = candidates(pos, pos.turn, E);
	let best = Infinity;
	const scored = [];
	for (const m of pool) {
		const c = costOf(pos, m);
		scored.push([m, c]);
		if (c < best) best = c;
	}
	return { best, moves: scored.filter(([, c]) => c === best).map(([m]) => m), pool: pool.length };
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');

const band = (r) => (r < 1000 ? '<1000' : r < 1400 ? '1000-1399' : r < 1800 ? '1400-1799' : '1800+');
const tally = new Map();
const bump = (key, field) => {
	if (!tally.has(key)) tally.set(key, { n: 0, find: 0, explain: 0, deficiency: 0 });
	tally.get(key)[field]++;
};

let seen = 0;
let starved = 0;
const misses = [];

for (const line of rows) {
	if (seen >= LIMIT) break;
	const parts = line.split('|');
	const csv = parts.slice(2).join('|').split(',');
	const [, fen, movesStr, ratingStr, , , , themesStr] = csv;
	const themes = (themesStr ?? '').split(' ').filter(Boolean);
	if (ONLY && !themes.includes(ONLY)) continue;
	const rating = Number(ratingStr);
	const mv = movesStr.split(' ');
	if (mv.length < 2) continue;

	let before;
	try {
		before = positionFromFen(fen);
	} catch {
		continue;
	}

	let after;
	try {
		after = play(before, mv[0]); // the opponent's blunder
	} catch {
		continue;
	}

	seen++;
	const solution = mv[1];

	// ---- FIND ----
	const { best, moves } =
		DEPTH <= 1
			? bestMoves(after)
			: (() => {
					const b = searchBest(after, DEPTH);
					return { best: b.length ? b[0].score : 0, moves: b.map((x) => x.move) };
				})();
	const found = moves.some((m) => uci(m) === solution);
	const v = cover(after);
	const deficiency = v.cover === null && v.obligations.length > 0;

	// ---- EXPLAIN: did the blunder create something? ----
	const victim = before.turn; // the side that blundered
	const hangBefore = Math.max(0, ...obligations(before.board, victim, before.isCheck()).map((o) => o.w).filter(Number.isFinite), 0);
	const hangAfter = Math.max(0, ...obligations(after.board, victim, false).map((o) => o.w).filter(Number.isFinite), 0);
	const created = Math.max(0, hangAfter - hangBefore);

	for (const key of [...themes.map((t) => `theme:${t}`), `band:${band(rating)}`, 'ALL']) {
		bump(key, 'n');
		if (found) bump(key, 'find');
		if (created > 0) bump(key, 'explain');
		if (deficiency) bump(key, 'deficiency');
	}

	if (!found && misses.length < 15) {
		misses.push({ fen, blunder: mv[0], solution, best, mine: moves.slice(0, 3).map(uci), themes: themes.join(' ') });
	}
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '—');
const show = (label) => {
	const t = tally.get(label);
	if (!t || t.n < 20) return null;
	return `${label.padEnd(28)} n=${String(t.n).padStart(5)}  find ${pct(t.find, t.n).padStart(4)}  deficiency ${pct(t.deficiency, t.n).padStart(4)}  created ${pct(t.explain, t.n).padStart(4)}`;
};

console.log(`\npuzzles evaluated: ${seen}   (budget exhausted in ${starved})\n`);
console.log(show('ALL') ?? '');
console.log('\n-- by rating band --');
for (const b of ['<1000', '1000-1399', '1400-1799', '1800+']) {
	const s = show(`band:${b}`);
	if (s) console.log(s);
}
console.log('\n-- by theme, best first --');
const themeRows = [...tally.keys()]
	.filter((k) => k.startsWith('theme:'))
	.map((k) => [k, tally.get(k)])
	.filter(([, t]) => t.n >= 20)
	.sort((a, b) => b[1].find / b[1].n - a[1].find / a[1].n);
for (const [k] of themeRows) console.log(show(k));

console.log(`\n-- misses --`);
for (const m of misses) {
	console.log(`  ${m.fen}`);
	console.log(`    blunder ${m.blunder}  solution ${m.solution}  mine ${m.mine.join(',')} (cost ${m.best})  [${m.themes}]`);
}
