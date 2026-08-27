// Ties should be impossible in a puzzle. So what distinguishes the solution?
//
// Will: "Ties should be impossible in puzzles (by definition), so it's probably
// a symptom of incorrect implementation of theory."
//
// Looked at rather than theorised: 14CuA ply 1's solution is Qf5-d5+, a CHECK,
// scored 0 and tied with g2g4 — because the check is answerable at no cost. One
// ply says they are equal. They are not: one forces the reply and the other does
// not, and the formalism already says so —
//
//   §4.4  check is the maximal element; nothing can interrupt it
//   §6.4  a forcing interruption preserves chain parity; a quiet one flips it
//   §9.3  candidates are the option set the graph enumerates
//
// FORCING is in the theory and is not in the ranking. This measures three ways
// of putting it there, all SYMMETRIC — the quantity is the difference between
// what I leave them and what they leave me, never one side's alone.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const MODE = process.argv[3] ?? 'none';
const d = mkdtempSync(join(tmpdir(), 'ft-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { concedes } from './src/domain/concede2';
export { gamma, due } from './src/domain/cover2';
export { V, other, seeValue } from './src/domain/exchange';
export { claims } from './src/domain/cover';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { reach as reachOf } from './src/domain/reach';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

/** Legal moves, counted. The crudest reading of "option set". */
const options = (pos, side) => {
	if (pos.turn !== side) return null; // only the side to move has options
	let n = 0;
	for (const f of pos.board[side]) for (const _ of pos.dests(f)) n++;
	return n;
};

/**
 * Moves that do not simply lose material — FINDINGS.md's soft-compulsion filter,
 * which that document measured at rho 0.76 against Stockfish and then set aside.
 */
const viable = (pos, side) => {
	if (pos.turn !== side) return null;
	let n = 0;
	for (const f of pos.board[side]) for (const t of pos.dests(f)) {
		const b = pos.board.clone();
		const pc = b.take(f); if (!pc) continue;
		b.take(Number(t)); b.set(Number(t), pc);
		if (M.seeValue(b, Number(t), M.other(side)) <= 0) n++;
	}
	return n;
};

/**
 * Viable moves for a side regardless of whose turn it is.
 *
 * `pos.dests` answers only for the side to move, so a symmetric count cannot use
 * it for both. This asks the same question of the other side's pieces directly,
 * which is what "symmetric" has to mean here: the same measurement applied to
 * both, not one measurement and its absence.
 */
const viableFor = (pos, side) => {
	let n = 0;
	for (const f of pos.board[side]) {
		const pc = pos.board.get(f);
		if (!pc) continue;
		for (const t of M.reachOf(pos.board, f, { limit: 1 }).dist) {
			if (t[1] !== 1) continue;
			const b = pos.board.clone();
			const q = b.take(f); if (!q) continue;
			b.take(t[0]); b.set(t[0], q);
			if (M.seeValue(b, t[0], M.other(side)) <= 0) n++;
		}
	}
	return n;
};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let plies = 0, right = 0, tie = 0, inTie = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const want = p.moves[i].slice(0, 4);
			const me = pos.turn, them = M.other(me);
			const rows = [];
			for (const from of pos.board[me]) for (const to of pos.dests(from)) {
				const m = { from, to: Number(to) };
				const taken = pos.board.get(m.to) ? M.V[pos.board.get(m.to).role] : 0;
				let n; try { n = pos.clone(); n.play({ from: m.from, to: m.to, promotion: (pos.board.get(m.from)?.role === 'pawn' && (m.to >> 3 === 0 || m.to >> 3 === 7)) ? 'queen' : undefined }); } catch { continue; }
				const primary = taken + M.concedes(n, n.turn).loss - M.concedes(n, M.other(n.turn)).loss;
				let force = 0;
				if (MODE === 'legal') force = -(options(n, them) ?? 0);
				else if (MODE === 'viable') force = -(viable(n, them) ?? 0);
				else if (MODE === 'check') force = n.isCheck() ? 1 : 0;
				// SYMMETRIC: what I leave them against what they leave me. Counting
				// only their options is the asymmetry that made the invasion row
				// misprice — the attacker's journey measured and the defender's not.
				else if (MODE === 'quotient') {
					const theirs = viable(n, them) ?? 0;
					const back = n.clone();
					// The same question with the turn flipped, so neither side's count
					// is privileged by whose move it happens to be.
					const mineCount = viableFor(back, me);
					force = mineCount - theirs;
				}
				rows.push({ uci: sq(m.from) + sq(m.to), primary, force });
			}
			if (!rows.length) continue;
			const p1 = Math.max(...rows.map((r) => r.primary));
			const lead = rows.filter((r) => r.primary === p1);
			const f1 = Math.max(...lead.map((r) => r.force));
			const best = lead.filter((r) => r.force === f1);
			if (best.length > 1) { tie++; if (best.some((r) => r.uci === want)) inTie++; }
			else if (best[0].uci === want) right++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${(100 * n / plies).toFixed(1)}%`;
console.log(`\n  tie-break = ${MODE.padEnd(7)}  outright ${pc(right).padStart(6)}   tie ${pc(tie).padStart(6)}   answer-in-tie ${pc(inTie).padStart(6)}   ceiling ${pc(right + inTie)}`);
