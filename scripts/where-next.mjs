// What is actually failing, by theme and by bucket — the next target, chosen by
// the corpus rather than by whichever case was read last.
//
// Two sessions have now been spent on classes picked from a hand-read of the
// easiest failures. That worked for mate, and `pin-confound.mjs` is the standing
// reminder of when it does not. This reads the whole regenerated bucket file and
// asks three questions of it:
//
//   WHERE IS THE MASS      a theme with 200 failing plies is worth more than one
//                          with 12, whatever the second looks like by hand.
//   IS IT PRICE OR SIGHT   `blind` needs Γ or the candidate rule; `wrong` and
//                          `tied` need the traversal. They are different work.
//   DOES IT REPEAT         a puzzle failing at four consecutive plies is a
//                          mechanism that is wrong, not a position that is hard.
//                          That signature is what found the pawn race.
import { readFileSync } from 'node:fs';

const B = JSON.parse(readFileSync('src/data/ledgerBuckets.json', 'utf8'));
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const by = new Map(P.map((p) => [p.id, p]));

const rows = [];
for (const [id, plies] of Object.entries(B)) {
	const p = by.get(id);
	if (!p) continue;
	for (const [ply, v] of Object.entries(plies))
		rows.push({ id, ply: +ply, bucket: v.split(':')[0], mate: v.includes('mate'), rating: p.rating, themes: p.themes });
}

// Total solver plies per theme, so a failure count can be read as a rate.
const seen = {};
for (const p of P) {
	const solver = Math.floor(p.moves.length / 2);
	for (const t of p.themes) seen[t] = (seen[t] ?? 0) + solver;
}

const per = {};
for (const r of rows)
	for (const t of r.themes) {
		const e = (per[t] = per[t] ?? { n: 0, blind: 0, tied: 0, wrong: 0 });
		e.n++;
		e[r.bucket]++;
	}

console.log(`\n${rows.length} failing plies\n`);
const total = { blind: 0, tied: 0, wrong: 0 };
for (const r of rows) total[r.bucket]++;
console.log(`  blind ${total.blind}   tied ${total.tied}   wrong ${total.wrong}\n`);

console.log(`  theme              failing   of      rate    blind  tied  wrong`);
const ranked = Object.entries(per)
	.filter(([t]) => (seen[t] ?? 0) >= 40)
	.sort((a, b) => b[1].n - a[1].n)
	.slice(0, 16);
for (const [t, e] of ranked) {
	const of = seen[t] ?? 0;
	console.log(
		`  ${t.padEnd(18)} ${String(e.n).padStart(6)}  ${String(of).padStart(5)}  ${`${((100 * e.n) / of).toFixed(0)}%`.padStart(6)}   ${String(
			e.blind,
		).padStart(5)} ${String(e.tied).padStart(5)} ${String(e.wrong).padStart(5)}`,
	);
}

// A puzzle failing at several consecutive solver plies is the signature that
// found the race: not a hard position, a mechanism that is wrong throughout.
const streaks = {};
for (const [id, plies] of Object.entries(B)) {
	const p = by.get(id);
	if (!p) continue;
	const n = Object.keys(plies).length;
	const solver = Math.floor(p.moves.length / 2);
	if (n >= 3 && n >= solver) for (const t of p.themes) streaks[t] = (streaks[t] ?? 0) + 1;
}
console.log(`\n  puzzles failing at EVERY solver ply (3 or more) — a mechanism, not a position:`);
console.log(
	'   ' +
		Object.entries(streaks)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 12)
			.map(([t, n]) => `${t}:${n}`)
			.join('  '),
);
console.log('');
