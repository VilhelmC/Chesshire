// IS `sacrifice` A MECHANISM, OR IS IT JUST HARD? — the control that goes first.
//
// ---------------------------------------------------------------------------
// WHERE-NEXT.md §5, which is a standing rule in this project rather than a
// suggestion:
//
//   "A theme with a bad rate is a hypothesis ABOUT THAT THEME, not about the
//    mechanism its name suggests. Control for that before building anything."
//
// `sacrifice` misses 16%, against about 8% overall. That looks like a mechanism
// failing at a specific idea. But sacrifice puzzles are also rated higher than
// average and their solutions run longer, and BOTH of those are hard for reasons
// that have nothing to do with sacrifice. If the excess disappears once they are
// controlled for, the finding is "deep payoffs are hard" — a statement about the
// horizon — rather than "sacrifices are hard", a statement about a mechanism.
// Those want completely different work, and the difference is one script.
//
// STRATIFIED COMPARISON. Every solver ply is placed in a cell by
//
//     rating bucket  x  remaining solution plies
//
// and each theme's observed miss rate is compared against the miss rate of
// NON-theme plies in the same cells, weighted by how the theme's own plies are
// distributed across them. That is direct standardisation: it asks what the miss
// rate WOULD have been for ordinary positions of the same difficulty and depth.
//
//   observed   the theme's actual miss rate
//   expected   matched non-theme plies, same cells, same weights
//   EXCESS     observed - expected. This is the only number that is about the
//              theme rather than about the company it keeps.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const N = Number(process.argv[2] ?? 1031);
const CACHE = '/tmp/verdicts.json';

const M = await load(`export { ladderReport } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

// The solve is 500ms a ply, so the verdicts are cached: the analysis below gets
// re-run far more often than the search does, and re-solving to change a bucket
// boundary is how a measurement session turns into an afternoon.
let rows;
if (existsSync(CACHE) && !process.argv.includes('--fresh')) {
	rows = JSON.parse(readFileSync(CACHE, 'utf8'));
	console.log(`\n  ${rows.length} verdicts from cache (--fresh to re-solve)`);
} else {
	rows = [];
	let done = 0;
	for (const p of puzzles(N)) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		for (let i = 0; i < p.moves.length; i++) {
			if (i % 2 === 1) {
				let r;
				try {
					r = M.ladderReport(pos, 5);
				} catch {
					r = null;
				}
				if (r) {
					const hit = r.moves.some((m) => nm(m).slice(0, 4) === p.moves[i].slice(0, 4));
					rows.push({
						id: p.id,
						rating: p.rating,
						themes: p.themes,
						// How much solution is still to come. The direct measure of "the
						// payoff is further out", and the thing `sacrifice` is suspected of
						// being a proxy for.
						left: p.moves.length - i,
						miss: !hit,
						alone: hit && r.moves.length === 1,
					});
				}
			}
			try {
				pos = play(pos, p.moves[i]);
			} catch {
				break;
			}
		}
		if (++done % 100 === 0) process.stderr.write(`  ${done} puzzles, ${rows.length} plies\n`);
	}
	writeFileSync(CACHE, JSON.stringify(rows));
	console.log(`\n  ${rows.length} verdicts solved and cached`);
}

// ---------------------------------------------------------------------------
const ratingBucket = (r) => Math.min(6, Math.floor((r - 400) / 400)); // 400-wide
const leftBucket = (l) => (l <= 1 ? 1 : l <= 3 ? 3 : l <= 5 ? 5 : 7);
const cellOf = (row) => `${ratingBucket(row.rating)}|${leftBucket(row.left)}`;

const overall = mean(rows.map((r) => (r.miss ? 1 : 0)));
console.log(`  overall miss rate ${(100 * overall).toFixed(1)}%\n`);

// What the two suspected confounds do on their own, before any theme is named.
console.log('  the confounds, on their own');
const byRating = {};
const byLeft = {};
for (const r of rows) {
	(byRating[ratingBucket(r.rating)] ??= []).push(r.miss ? 1 : 0);
	(byLeft[leftBucket(r.left)] ??= []).push(r.miss ? 1 : 0);
}
console.log(
	`    by rating   ${Object.entries(byRating)
		.sort((a, b) => a[0] - b[0])
		.map(([k, v]) => `${400 + k * 400}+ ${(100 * mean(v)).toFixed(0)}%`)
		.join('  ')}`,
);
console.log(
	`    by plies left ${Object.entries(byLeft)
		.sort((a, b) => a[0] - b[0])
		.map(([k, v]) => `${k === '7' ? '7+' : k} ${(100 * mean(v)).toFixed(0)}%`)
		.join('  ')}`,
);

// ---------------------------------------------------------------------------
const themes = [...new Set(rows.flatMap((r) => r.themes))].filter(
	(t) => rows.filter((r) => r.themes.includes(t)).length >= 100,
);

const out = [];
for (const theme of themes) {
	const mine = rows.filter((r) => r.themes.includes(theme));
	const observed = mean(mine.map((r) => (r.miss ? 1 : 0)));

	// Expected: for each of the theme's plies, the miss rate of NON-theme plies in
	// the same cell. Cells with no matched control contribute nothing rather than
	// falling back to the global rate, which would quietly reintroduce the bias.
	let num = 0;
	let den = 0;
	const cache = {};
	for (const r of mine) {
		const c = cellOf(r);
		if (!(c in cache)) {
			const control = rows.filter((x) => cellOf(x) === c && !x.themes.includes(theme));
			cache[c] = control.length >= 10 ? mean(control.map((x) => (x.miss ? 1 : 0))) : null;
		}
		if (cache[c] !== null) {
			num += cache[c];
			den++;
		}
	}
	if (den < mine.length * 0.6) continue; // too little matched control to speak
	out.push({ theme, n: mine.length, observed, expected: num / den, excess: observed - num / den });
}

out.sort((a, b) => b.excess - a.excess);
console.log(`\n  ${out.length} themes with mass, stratified by rating x plies-left\n`);
console.log(`  ${'theme'.padEnd(20)} ${'n'.padStart(5)} ${'observed'.padStart(9)} ${'expected'.padStart(9)} ${'EXCESS'.padStart(8)}`);
for (const t of out)
	console.log(
		`  ${t.theme.padEnd(20)} ${String(t.n).padStart(5)} ${(100 * t.observed).toFixed(1).padStart(8)}% ${(100 * t.expected).toFixed(1).padStart(8)}% ${((t.excess > 0 ? '+' : '') + (100 * t.excess).toFixed(1)).padStart(7)}%`,
	);

console.log(`\n  A theme whose EXCESS is near zero is not a mechanism finding: it fails`);
console.log(`  exactly as much as ordinary positions of the same rating and depth.`);
