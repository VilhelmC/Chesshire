// WHAT DOES DEPTH BUY THE MATERIAL RUNGS? — and what does it cost.
//
// The mate rung searches five plies. The material rungs search two. Every
// remaining OVERSHOT in the miss profile is a move worth nothing immediately that
// wins later — sacrifice, clearance, attraction — which is exactly what a two-ply
// search cannot see.
//
// `holds(pos, move, attacker, plies)` is the trichotomy with a depth. This runs
// the whole material rung at 2, 4 and 6 plies on the same positions and reports:
//
//   agrees      does the deeper search pick a move the shallow one also picked?
//   answer      does it pick the PUZZLE'S move?
//   value drift how far the claimed swing moves when the horizon does
//   ms          the thing that decides whether any of it can ship
//
// CONTROL FIRST: `holds(..., 2)` must reproduce `guarantees` exactly, or this is
// measuring a new function rather than a deeper one. Two scripts in this session
// have already been caught measuring themselves.
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 40);
const CAP = Number(process.argv[3] ?? 60);
const DEPTHS = (process.argv[4] ?? '2,4').split(',').map(Number);

const M = await load(`export { holds, guarantees, materialFor, allMoves, quiesce } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

// ---------------------------------------------------------------------------
{
	let n = 0;
	let same = 0;
	const bad = [];
	outer: for (const p of puzzles(30)) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		for (let i = 0; i < p.moves.length; i++) {
			if (i % 2 === 1)
				for (const m of M.allMoves(pos).slice(0, 8)) {
					n++;
					const a = M.guarantees(pos, m, pos.turn);
					const b = M.holds(pos, m, pos.turn, 2);
					if (a === b) same++;
					else if (bad.length < 5) bad.push(`${p.id} ${nm(m)}: guarantees ${a}, holds(2) ${b}`);
					if (n >= 1200) break outer;
				}
			try {
				pos = play(pos, p.moves[i]);
			} catch {
				break;
			}
		}
	}
	console.log(`\n  CONTROL — holds(2) against guarantees: ${same}/${n}`);
	if (same !== n) {
		console.log(`  holds() is not a deeper guarantees, it is a different function. Stop.`);
		console.log(`    ${bad.join('\n    ')}`);
		process.exit(1);
	}
}

const plies = [];
for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) plies.push({ id: p.id, rating: p.rating, pos, want: p.moves[i], themes: p.themes });
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}

/**
 * The material rung at one depth: every root move scored, best set returned.
 *
 * ORDERED BY THE SHALLOWER SEARCH, which is iterative deepening's whole trick and
 * costs nothing in correctness — alpha-beta returns the same value whatever order
 * the moves come in, it just reaches the cutoffs sooner. Without it a depth-4 run
 * over thirty root moves does not finish.
 */
function rungAt(pos, depth, order) {
	const attacker = pos.turn;
	const moves = order ?? M.allMoves(pos);
	let best = -Infinity;
	let picks = [];
	const scored = [];
	for (const m of moves) {
		// The running best is a real alpha: a move that cannot beat it cannot win
		// the maximum, so the window is exact.
		const v = M.holds(pos, m, attacker, depth, best - 0.5, Infinity);
		scored.push({ m, v });
		if (v > best + 0.5) {
			best = v;
			picks = [m];
		} else if (v > best - 0.5) picks.push(m);
	}
	scored.sort((a, b) => b.v - a.v);
	return { value: best - M.materialFor(pos.board, attacker), moves: picks, order: scored.map((s) => s.m) };
}

const rows = {};
for (const depth of DEPTHS) {
	let n = 0,
		hit = 0,
		agreeShallow = 0;
	let ms = 0;
	const drift = [];
	let baseline = null;
	for (const s of plies.slice(0, CAP)) {
		const t0 = Date.now();
		// Iterative deepening: 2 first, then use its ordering for the real depth.
		const shallow = rungAt(s.pos, 2, null);
		const r = depth === 2 ? shallow : rungAt(s.pos, depth, shallow.order);
		ms += Date.now() - t0;
		n++;
		if (r.moves.some((m) => nm(m).slice(0, 4) === s.want.slice(0, 4))) hit++;
		if (r.moves.some((m) => shallow.moves.some((x) => nm(x) === nm(m)))) agreeShallow++;
		if (Number.isFinite(r.value) && Number.isFinite(shallow.value)) drift.push(Math.abs(r.value - shallow.value));
	}
	rows[depth] = { n, hit, agreeShallow, ms, drift };
	console.log(
		`\n  depth ${String(depth).padStart(2)}   answer found ${String(hit).padStart(4)}/${n}  ${((100 * hit) / n).toFixed(1)}%` +
			`   agrees with depth 2 ${((100 * agreeShallow) / n).toFixed(1)}%` +
			`   ${(ms / n).toFixed(0)}ms/ply` +
			(drift.length ? `   value drift mean ${mean(drift).toFixed(0)}cp median ${q(drift, 0.5)}` : ''),
	);
}

const a = rows[DEPTHS[0]];
for (const d of DEPTHS.slice(1)) {
	const b = rows[d];
	console.log(
		`\n  ${DEPTHS[0]} -> ${d}   answer ${b.hit - a.hit >= 0 ? '+' : ''}${b.hit - a.hit}` +
			`   cost x${(b.ms / a.ms).toFixed(1)}`,
	);
}
