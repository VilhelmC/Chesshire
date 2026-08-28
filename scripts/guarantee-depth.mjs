// IS `guarantees` ACTUALLY A GUARANTEE? — the question the miss profile could
// not answer, because it used `guarantees` as its own referee.
//
// ---------------------------------------------------------------------------
// The material rungs are ONE PLY deep. `guaranteeWithHeld` is
//
//     min over the defender's replies of settled(...)
//
// with SEE at the leaf, and nothing after that. The mate rung searches to five.
// So the ladder currently claims "this move forces +5.00" on the strength of
// looking exactly one move ahead, and the word FORCED is doing work that one ply
// cannot support: the defender may hand back the man on their SECOND move.
//
// `ladder-misses.mjs` reported UNDERSHOT = 0, which sounds like soundness and is
// not — it compared the rung against `guarantees`, which is the same expression
// the rung is read off. It could only ever agree with itself.
//
// So: a referee that is not the thing being judged. `deep(k)` is the same
// question asked k plies out — a minimax with SEE at the leaves, no pruning, no
// heuristics.
//
// ---------------------------------------------------------------------------
// PARITY. THE FIRST VERSION OF THIS SCRIPT WAS WRONG, AND ITS OWN CONTROL SAID SO.
//
// It compared `deep(3)` against `guarantees` and reported that 36% of the
// ladder's forced claims collapsed. They did not. `settled()` credits WHOEVER IS
// TO MOVE with their best exchange, so a leaf at odd depth hands that credit to
// the defender and a leaf at even depth hands it to us. Comparing depth 2 with
// depth 3 therefore compares "we get the last exchange" with "they do", and the
// gap it measures is the parity, not the recovery. Every single "100 handed back"
// was one side of a pawn trade being counted for the other player.
//
// This is `engine/score.ts`'s lesson in a third costume: a difference between two
// measurements is only meaningful when the two are made the same way.
//
// So the comparison is SAME-PARITY — `deep(2)` against `deep(4)` — and the
// control that licenses it is
//
//     deep(2) == guarantees,  exactly, on every (position, move) pair
//
// asserted below before anything else is reported. Without it this script can
// only agree with itself, which is the failure it exists to catch in the ladder.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 120);
const MAXPLY = Number(process.argv[3] ?? 5);

const M = await load(`export { ladderReport, materialFor, settled, guarantees, allMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const after = (pos, m) => {
	const n = pos.clone();
	n.play(m);
	return n;
};

/**
 * What `move` is worth to `attacker` when the game continues for `plies` more.
 *
 * Deliberately the dumbest correct thing: full minimax, every legal move at every
 * node, SEE only at the leaves. It is far too slow to ship and that is the point
 * — it is the referee, so it must not share a single shortcut with the thing it
 * is judging. `plies = 2` reproduces `guarantees` exactly; see PARITY above.
 */
function deep(pos, move, attacker, plies) {
	const child = after(pos, move);
	return node(child, plies - 1, attacker);
}
function node(pos, left, attacker) {
	if (pos.isCheckmate()) return pos.turn === attacker ? -Infinity : Infinity;
	const moves = M.allMoves(pos);
	if (!moves.length) return M.settled(pos.board, pos.turn, attacker); // stalemate
	if (left <= 0) return M.settled(pos.board, pos.turn, attacker);
	const mine = pos.turn === attacker;
	let best = mine ? -Infinity : Infinity;
	for (const m of moves) {
		const v = node(after(pos, m), left - 1, attacker);
		if (mine ? v > best : v < best) best = v;
	}
	return best;
}

// ---------------------------------------------------------------------------
// THE CONTROL, FIRST AND FATAL.
// ---------------------------------------------------------------------------
{
	let n = 0;
	let same = 0;
	const bad = [];
	outer: for (const p of puzzles(40)) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		for (let i = 0; i < p.moves.length; i++) {
			if (i % 2 === 1) {
				const att = pos.turn;
				for (const m of M.allMoves(pos).slice(0, 6)) {
					n++;
					const a = M.guarantees(pos, m, att);
					const b = deep(pos, m, att, 2);
					if (a === b) same++;
					else if (bad.length < 6) bad.push(`${p.id} ${nm(m)}: guarantees ${a}, referee ${b}`);
					if (n >= 1500) break outer;
				}
			}
			try {
				pos = play(pos, p.moves[i]);
			} catch {
				break;
			}
		}
	}
	console.log(`\n  CONTROL — deep(2) against guarantees on ${n} (position, move) pairs: ${same}/${n}`);
	if (same !== n) {
		console.log(`  REFEREE IS WRONG. Everything below would be measuring it, not the ladder.`);
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

let checked = 0;
let held = 0;
const drops = [];
const dropSize = [];
let ms = 0;

for (const s of plies) {
	let r;
	try {
		r = M.ladderReport(s.pos, 5);
	} catch {
		continue;
	}
	// Only positions where the ladder made a MATERIAL claim. Mate is verified by
	// `isCheckmate` at the leaf and needs no referee.
	if (!r.forced || r.value === 'mate' || !r.moves.length) continue;
	const attacker = s.pos.turn;
	const base = M.materialFor(s.pos.board, attacker);
	const claimed = r.value;
	const move = r.moves[0];

	const t0 = Date.now();
	let d4;
	try {
		d4 = deep(s.pos, move, attacker, 4) - base;
	} catch {
		continue;
	}
	ms += Date.now() - t0;
	checked++;

	// A DEEPER SEARCH MAY FIND MORE — that is not a defect, it is the horizon
	// moving in our favour. Only a SHORTFALL falsifies "forced".
	if (d4 >= claimed - 0.5) held++;
	else {
		dropSize.push(claimed - d4);
		if (drops.length < 15)
			drops.push(
				`${s.id} (${s.rating}) ${s.themes.slice(0, 2).join(',')} — ${nm(move)}:` +
					` claimed ${claimed}, holds only ${d4 === -Infinity ? '-mate' : d4}` +
					` (${claimed - d4 === Infinity ? 'mated' : (claimed - d4).toFixed(0) + ' handed back'})`,
			);
	}
	if (checked >= Number(process.argv[4] ?? 400)) break;
}

console.log(`\n  ${checked} positions where the ladder called a MATERIAL swing forced`);
console.log(`    ${(ms / Math.max(1, checked)).toFixed(0)}ms a position to referee at 4 plies\n`);
console.log(`  HOLDS at 4 plies   ${String(held).padStart(4)}  ${((100 * held) / checked).toFixed(1)}%`);
console.log(`  hands some back    ${String(checked - held).padStart(4)}  ${((100 * (checked - held)) / checked).toFixed(1)}%   ← "forced" was not forced`);
if (dropSize.length)
	console.log(`    given back: mean ${mean(dropSize).toFixed(0)}cp  median ${q(dropSize, 0.5)}  max ${Math.max(...dropSize)}`);
if (drops.length) console.log(`\n  ${drops.join('\n  ')}`);
