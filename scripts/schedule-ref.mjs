// Is the traversal's schedule OPTIMAL, or only feasible?
//
// `answers-two.mjs` counts positions where a shared edge exists whose rows split
// between saved and collected. That is a CANDIDATE miss: the schedule may be
// declining the shared move for a good reason. It reported 7.2% without arrival
// rows and 70.1% with them, and a candidate count cannot tell those apart from
// real misses.
//
// So: a second, independent scheduler, written from the statement of the problem
// rather than from `traverse.ts`, and compared on `lost`.
//
//   Enumerate subsets of the candidate moves (no two moves by one piece).
//   Order each subset by EARLIEST DUE DATE — 1||Lmax is solved exactly by EDD,
//   so this is optimal ordering and not a heuristic.
//   A row is saved iff some move in the set that answers it lands by its budget.
//   Keep the subset that leaves the least weight behind.
//
// Exponential in the candidate-move count, so it refuses above a stated bound
// rather than sampling: a truncated reference proves nothing.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const CAP = Number(process.argv[4] ?? 18);
const d = mkdtempSync(join(tmpdir(), 'sr-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, arrivals, isLive } from './src/domain/complex';
export { gamma, tempiLeft } from './src/domain/gamma';
export { traverse } from './src/domain/traverse';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const W = (w) => (Number.isFinite(w) ? w : 1e9);

/** The jobs one side faces, rebuilt from the complex rather than read off the module. */
function jobsFor(c, es, side) {
	const out = [];
	c.obligations.forEach((o, i) => {
		if (!M.isLive(o, c.board)) return;
		if (M.other(o.claimant) !== side) return;
		const budget = M.tempiLeft(o, c.turn);
		const byMove = new Map();
		for (const x of es) {
			if (x.obligation !== i || x.cost > budget) continue;
			const k = x.piece * 64 + x.to;
			const had = byMove.get(k);
			if (!had || x.cost < had.cost) byMove.set(k, { piece: x.piece, to: x.to, cost: x.cost });
		}
		out.push({ row: i, budget, weight: o.weight, moves: [...byMove.values()] });
	});
	return out;
}

/** The least weight this side can be left owing. Exhaustive; null if refused. */
function bestLost(jobs) {
	const cand = new Map();
	for (const j of jobs) for (const m of j.moves) cand.set(m.piece * 64 + m.to, m);
	const moves = [...cand.values()];
	if (moves.length > CAP) return null;

	let best = jobs.reduce((n, j) => n + W(j.weight), 0); // save nothing
	for (let mask = 1; mask < 1 << moves.length; mask++) {
		const set = moves.filter((_, i) => mask & (1 << i));
		// One move per piece: a piece cannot be in two places.
		const pieces = new Set(set.map((m) => m.piece));
		if (pieces.size !== set.length) continue;

		// Each move's due date is the tightest budget among rows it could answer.
		const due = set.map((m) => {
			let dd = Infinity;
			for (const j of jobs) if (j.moves.some((x) => x.piece === m.piece && x.to === m.to)) dd = Math.min(dd, j.budget);
			return { ...m, dd };
		});
		due.sort((a, b) => a.dd - b.dd || a.cost - b.cost);
		let spent = 0;
		let ok = true;
		for (const m of due) {
			spent += m.cost;
			m.at = spent;
			if (spent > m.dd) { ok = false; break; }
		}
		if (!ok) continue;

		let lost = 0;
		for (const j of jobs) {
			const covered = due.some((m) => m.at <= j.budget && j.moves.some((x) => x.piece === m.piece && x.to === m.to));
			if (!covered) lost += W(j.weight);
		}
		if (lost < best) best = lost;
	}
	return best;
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let n = 0, checked = 0, skipped = 0, worse = 0, totalGap = 0, maxGap = 0;
const cases = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const base = M.complex(pos);
		const c = ARR ? { ...base, obligations: [...base.obligations, ...M.arrivals(pos.board, { arrivalHorizon: ARR })] } : base;
		const es = M.gamma(c);
		const t = M.traverse(c, es);
		if (t.refused) { skipped++; try { pos = play(pos, p.moves[i]); } catch { break; } continue; }

		let any = false;
		for (const side of ['white', 'black']) {
			const jobs = jobsFor(c, es, side);
			if (!jobs.length) continue;
			const ref = bestLost(jobs);
			if (ref === null) { any = true; continue; }
			const mine = t.collected
				.filter((o) => M.other(o.claimant) === side)
				.reduce((s, o) => s + W(o.weight), 0);
			checked++;
			if (mine > ref) {
				worse++;
				totalGap += mine - ref;
				maxGap = Math.max(maxGap, mine - ref);
				if (cases.length < 6) cases.push(`${p.id} ply ${i} ${side}: module lost ${mine}, optimum ${ref}\n      ${M.makeFen(pos.toSetup())}`);
			}
		}
		if (any) skipped++;
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}, candidate-move cap ${CAP}`);
console.log(`  side-schedules compared : ${checked}   refused/skipped ${skipped}`);
console.log(`  module WORSE than optimum : ${worse} (${checked ? (100*worse/checked).toFixed(2) : 0}%)`);
console.log(`  weight lost needlessly, total / worst : ${totalGap} / ${maxGap}\n`);
for (const x of cases) console.log(`  ${x}\n`);
