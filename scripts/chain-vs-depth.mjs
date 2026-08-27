// Two searches, same puzzles: fixed depth against coercion-to-a-settled-leaf.
//
// ---------------------------------------------------------------------------
// The question is Will's: should coercion decide what to EXPLORE rather than
// what to play, with the depth counter thrown away and a branch ending when the
// position is settled? This runs both searches over the same solver plies and
// reports found / tied / missed and the time each takes.
//
// Solver plies only, per the standing rule: the opponent's replies in a Lichess
// line are one engine's pick among moves that may lose equally.
//
// Usage: node scripts/chain-vs-depth.mjs [puzzles] [depth] [perMove]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 120);
const DEPTH = Number(process.argv[3] ?? 4);
const PER_MOVE = Number(process.argv[4] ?? 60_000);

const dir = mkdtempSync(join(tmpdir(), 'cvd-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { chainMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/chain.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, chainMoves, positionFromFen, parseSquare, makeSquare } = await import(outfile);

const uci = (m) =>
	`${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? (m.promotion[0] === 'k' ? 'n' : m.promotion[0]) : ''}`;
const play = (pos, u) => {
	const n = pos.clone();
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	n.play(promo ? { from, to, promotion: promo } : { from, to });
	return n;
};

/** found / tied / missed for one ranking. */
function verdict(scored, want) {
	if (!scored.length) return 'missed';
	const top = scored[0].score;
	const played = scored.find((s) => uci(s.move) === want);
	if (!played || played.score !== top) return 'missed';
	const ties = scored.filter((s) => s.score === top).length;
	return ties <= 2 || scored.length <= 1 ? 'found' : 'tied';
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const tally = {
	depth: { found: 0, tied: 0, missed: 0, ms: 0 },
	chain: { found: 0, tied: 0, missed: 0, ms: 0, exhausted: 0 },
};
const flips = [];
let puzzles = 0;
let plies = 0;

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [id, fen, movesStr, , , , , themes] = csv;
	const mv = movesStr.split(' ');
	if (mv.length < 2) continue;

	let pos;
	try {
		pos = positionFromFen(fen);
	} catch {
		continue;
	}
	const at = [];
	let ok = true;
	for (const u of mv) {
		at.push(pos);
		try {
			pos = play(pos, u);
		} catch {
			ok = false;
			break;
		}
	}
	if (!ok) continue;
	puzzles++;

	for (let i = 1; i < mv.length; i += 2) {
		plies++;
		let t = Date.now();
		const d = verdict(scoreMoves(at[i], DEPTH).scored, mv[i]);
		tally.depth.ms += Date.now() - t;
		tally.depth[d]++;

		t = Date.now();
		const c = chainMoves(at[i], PER_MOVE);
		tally.chain.ms += Date.now() - t;
		tally.chain.exhausted += c.exhausted ? 1 : 0;
		const cv = verdict(c.scored, mv[i]);
		tally.chain[cv]++;

		if (d !== cv && flips.length < 12) {
			flips.push({ id, i, themes, depth: d, chain: cv, want: mv[i], chose: c.scored[0] && uci(c.scored[0].move) });
		}
	}
	process.stderr.write(`\r${puzzles} puzzles, ${plies} solver plies`);
}
process.stderr.write('\n');

const pct = (n) => `${((n / plies) * 100).toFixed(0)}%`;
console.log(`\n${puzzles} puzzles, ${plies} solver plies\n`);
console.log('                found        tied       missed      time');
for (const [name, t] of Object.entries(tally)) {
	console.log(
		`  ${name.padEnd(8)} ${String(t.found).padStart(5)} ${pct(t.found).padStart(6)} ${String(t.tied).padStart(5)} ${pct(t.tied).padStart(6)} ${String(t.missed).padStart(5)} ${pct(t.missed).padStart(6)}   ${(t.ms / 1000).toFixed(1)}s`,
	);
}
if (tally.chain.exhausted) console.log(`\n  chain hit its node ceiling on ${tally.chain.exhausted} plies`);

console.log('\n-- where they disagree --');
for (const f of flips) {
	console.log(`  ${f.id} ply ${f.i}: depth ${f.depth}, chain ${f.chain}  (wanted ${f.want}, chain chose ${f.chose})  [${f.themes}]`);
}
