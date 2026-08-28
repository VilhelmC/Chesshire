// M3 — can the material rung prove what the puzzle's own line achieves?
//
// Mate had a label to check against. Material has none, so the ground truth is
// taken from the corpus line itself: play the solution to its end, measure the
// settled swing, then ask the rung whether that swing was forceable from the
// root. If the answer is no, either the goal is defined wrongly or the line was
// not forced — and both are worth knowing before the corpus gate.
//
// Also reports NODES, because M3 is the milestone where a node stops being
// cheap: mate terminates on one call, material terminates on an evaluation.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 40);
const d = mkdtempSync(join(tmpdir(), 'm3-'));
const e = join(process.cwd(), '.m3-entry.ts');
writeFileSync(
	e,
	`export { solve } from './src/domain/pns';
export { materialGoal, settled, allMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`,
);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);

const sq = M.makeSquare;
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const PR = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
const mk = (u) => {
	const m = { from: idx(u), to: idx(u.slice(2)) };
	if (u[4]) m.promotion = PR[u[4]];
	return m;
};
const play = (p, m) => {
	const n = p.clone();
	n.play(m);
	return n;
};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const MATERIAL = ['hangingPiece', 'fork', 'trappedPiece', 'skewer', 'discoveredAttack', 'pin'];
const pool = P.filter((p) => MATERIAL.some((t) => p.themes.includes(t)) && !p.themes.some((t) => t.startsWith('mateIn'))).slice(0, N);

const buckets = { proved: 0, refuted: 0, unknown: 0 };
const nodes = [];
const swings = [];
let ms = 0;
const failures = [];

for (const p of pool) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	pos = play(pos, mk(p.moves[0])); // the blunder; the solver answers from here
	const attacker = pos.turn;
	const base = M.settled(pos.board, pos.turn, attacker);

	// Ground truth: play the rest of the puzzle's line and see what it banks.
	let end = pos;
	for (let i = 1; i <= Math.min(p.moves.length - 1, 3); i++) {
		try {
			end = play(end, mk(p.moves[i]));
		} catch {
			break;
		}
	}
	const want = M.settled(end.board, end.turn, attacker) - base;
	// DEPTH IS THE LADDER'S, NOT THE PUZZLE'S. The first version asked for the
	// whole line — nine and fifteen plies on the hard ones — which is not a
	// question the ladder ever poses. Configurations saturate at d = 4, so the
	// rungs run to a small depth and deepen; a fifteen-ply proof is not a rung.
	const plies = Math.min(p.moves.length - 1, 3);
	if (want <= 0 || plies < 1) continue; // nothing material to prove
	swings.push(want);

	const t0 = Date.now();
	const r = M.solve(M.materialGoal(attacker, want, base, { seed: true }), pos, plies, 300_000);
	ms += Date.now() - t0;
	nodes.push(r.nodes);
	if (r.proved) buckets.proved++;
	else if (r.refuted) {
		buckets.refuted++;
		if (failures.length < 6) failures.push(`${p.id} (${p.rating}) want ${want} in ${plies} — REFUTED [${p.themes.join(',')}]`);
	} else {
		buckets.unknown++;
		if (failures.length < 6) failures.push(`${p.id} (${p.rating}) want ${want} in ${plies} — unknown, ${r.nodes} nodes`);
	}
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const q = (a, f) => {
	const b = [...a].sort((x, y) => x - y);
	return b[Math.min(b.length - 1, Math.floor(f * b.length))];
};
const n = nodes.length;
console.log(`\n  ${n} material puzzles (non-mate), goal taken from each puzzle's own line`);
console.log(`    swing sought   mean ${mean(swings).toFixed(0)}cp   median ${q(swings, 0.5)}`);
console.log(`    PROVED   ${buckets.proved}  (${((100 * buckets.proved) / n).toFixed(1)}%)`);
console.log(`    refuted  ${buckets.refuted}   unknown ${buckets.unknown}`);
console.log(`    nodes    mean ${mean(nodes).toFixed(0)}   median ${q(nodes, 0.5)}   p90 ${q(nodes, 0.9)}   max ${Math.max(...nodes)}`);
console.log(`    time     ${(ms / 1000).toFixed(1)}s total, ${(ms / n).toFixed(0)}ms a puzzle`);
if (failures.length) console.log(`\n  not proved:\n    ${failures.join('\n    ')}`);
