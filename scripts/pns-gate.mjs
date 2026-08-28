// M1 GATE — does the proof engine solve mate, knowing no chess?
//
// The engine (src/domain/pns.ts) is domain-free. Everything chess-shaped is in
// the adapter below, and the adapter deliberately uses the TRIVIAL move
// generator — every legal move. That is the point of this gate: a proof engine
// that needs a clever move generator to be CORRECT is not a proof engine, it is
// a heuristic wearing one. M2 swaps in the ladder's generator and must not
// change a single answer.
//
// Mate in N is 2N-1 plies: attacker, defender, attacker, ... , mate.
//
// Reports nodes expanded, which is the number M2 has to beat.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 60);
const d = mkdtempSync(join(tmpdir(), 'pns-'));
const e = join(process.cwd(), '.pns-entry.ts');
writeFileSync(
	e,
	`export { solve } from './src/domain/pns';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
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

/** Every legal move, promotions expanded — the trivial generator. */
const allMoves = (p) => {
	const out = [];
	for (const [from, ds] of p.allDests()) {
		const pc = p.board.get(from);
		const last = pc.color === 'white' ? 7 : 0;
		for (const to of ds) {
			if (pc.role === 'pawn' && (to >> 3) === last)
				for (const pr of ['queen', 'rook', 'bishop', 'knight']) out.push({ from, to, promotion: pr });
			else out.push({ from, to });
		}
	}
	return out;
};

/**
 * The mate goal, as a Problem.
 *
 * `attacker` is fixed at the root and never changes; every verdict below is
 * still expressed from the point of view of whoever is to move at the node,
 * which is what lets the engine stay side-agnostic.
 */
const mateProblem = (attacker) => ({
	key: (s) => M.makeFen(s.toSetup()).split(' ').slice(0, 4).join(' '),
	children: (s) => allMoves(s).map((m) => play(s, m)),
	terminal: (s, depthLeft) => {
		// Checkmate first, so a mate delivered exactly as the depth runs out counts.
		if (s.isCheckmate()) return 'moverLoses';
		// A draw is a failure for the attacker and a success for the defender —
		// the one place the goal is not symmetric, and the reason `Verdict` is
		// mover-relative rather than win/loss.
		if (s.isStalemate() || s.isInsufficientMaterial()) return s.turn === attacker ? 'moverLoses' : 'moverWins';
		if (depthLeft <= 0) return s.turn === attacker ? 'moverLoses' : 'moverWins';
		return null;
	},
});

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const uci = (a, b) => {
	// the move between two positions, read off the boards
	let from = -1,
		to = -1;
	for (const s of a.board.occupied) if (!b.board.occupied.has(s) || b.board.get(s)?.color !== a.board.get(s)?.color) if (a.board.get(s)?.color === a.turn) from = s;
	for (const s of b.board.occupied) if (b.board.get(s)?.color === a.turn && (!a.board.occupied.has(s) || a.board.get(s)?.color !== a.turn)) to = s;
	return from >= 0 && to >= 0 ? sq(from) + sq(to) : '??';
};

for (const [theme, plies] of [
	['mateIn1', 1],
	['mateIn2', 3],
	['mateIn3', 5],
]) {
	const pool = P.filter((x) => x.themes.includes(theme)).slice(0, N);
	let proved = 0,
		right = 0,
		refuted = 0,
		dunno = 0;
	const nodes = [];
	const misses = [];
	let ms = 0;
	for (const p of pool) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		pos = play(pos, mk(p.moves[0]));
		const t0 = Date.now();
		const r = M.solve(mateProblem(pos.turn), pos, plies);
		ms += Date.now() - t0;
		nodes.push(r.nodes);
		if (r.proved) {
			proved++;
			const first = r.line.length > 1 ? uci(r.line[0], r.line[1]) : '??';
			if (first === p.moves[1].slice(0, 4)) right++;
			else if (misses.length < 4) misses.push(`${p.id} found ${first} want ${p.moves[1]}`);
		} else if (r.refuted) refuted++;
		else dunno++;
	}
	const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
	const pc = (n) => `${((100 * n) / pool.length).toFixed(1)}%`;
	console.log(
		`  ${theme}  n=${String(pool.length).padStart(3)}  depth ${plies}   PROVED ${String(proved).padStart(3)} ${pc(proved)}   first move matches ${String(right).padStart(3)}   refuted ${refuted}  unknown ${dunno}   nodes mean ${mean(nodes).toFixed(0)}  total ${(ms / 1000).toFixed(1)}s`,
	);
	if (misses.length) console.log(`      differs from the puzzle's move (a dual, or a bug): ${misses.join(' · ')}`);
}

// ---- REFUTATION: the certificate, which is the reason for using PNS at all.
//
// A mate-in-2 position asked for a mate in ONE must come back REFUTED, not
// "unknown". Proving the absence is the half alpha-beta cannot do, so it is
// tested explicitly rather than assumed to follow from the proving half.
{
	const pool = P.filter((x) => x.themes.includes('mateIn2')).slice(0, N);
	let refuted = 0, wrongly = 0, dunno = 0;
	const nodes = [];
	for (const p of pool) {
		let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		pos = play(pos, mk(p.moves[0]));
		const r = M.solve(mateProblem(pos.turn), pos, 1);
		nodes.push(r.nodes);
		if (r.refuted) refuted++; else if (r.proved) wrongly++; else dunno++;
	}
	const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
	console.log(`\n  REFUTATION  mateIn2 positions asked for mate in 1:  refuted ${refuted}/${pool.length}   wrongly proved ${wrongly}   unknown ${dunno}   nodes mean ${mean(nodes).toFixed(0)}`);
	if (wrongly) console.log('      WRONGLY PROVED — the engine claims a mate that is not there.');
}
