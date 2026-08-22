// The knot before it happens.
//
// ---------------------------------------------------------------------------
// Will's summary of the whole idea, which is better than the one I had been
// working from:
//
//   "Most of this is simple application of SEE — sorting exchange knots by
//    value and seeing where the chain would be broken. The modification is to
//    look at the knot BEFORE it happens, by seeing which pieces are within
//    mobilisation distance of the knot, and accounting for tempo shifts."
//
// The previous version answered a different question. It let the attacker make
// ONE preparing move and the defender ONE reply, which is enough for "is this
// exchange good" and useless for "is committing to this plan good" — and the
// second is the question a pin actually poses. Committing a rook to a file
// costs a tempo; the defender spends that tempo too; whether the knot that
// results is winnable is a RACE, not a count.
//
// So this is a small alternating search, deliberately narrow: only moves that
// touch the contested square, plus captures and checks, to a few plies. It is a
// search and says so — the claim in EXPLOITABILITY.md was that tactics fold
// into a static reading, and at two tempi with tempo-gaining defences that
// claim does not survive contact. What keeps it honest is the narrowness: the
// branching is the handful of moves that bear on one square, not the position.
// ---------------------------------------------------------------------------

import type { Square, Color } from 'chessops/types';
import type { Chess } from 'chessops/chess';
import { attacks } from 'chessops/attacks';
import { makeSquare } from './chess';
import { VALUE } from './contest';
import { bestCapture } from './reply';

export type RaceResult = {
	/** Material swing in centipawns, attacker's point of view. */
	value: number;
	/** The sequence that produces it, in coordinate notation. */
	line: string[];
	/** How many plies were searched. */
	plies: number;
	/** True when the search hit its own limits rather than a quiet position. */
	truncated: boolean;
};

/** Material on the board for one side, in centipawns. */
function material(pos: Chess, side: Color): number {
	let total = 0;
	for (const sq of pos.board[side]) {
		const p = pos.board.get(sq);
		if (p && p.role !== 'king') total += VALUE[p.role];
	}
	return total;
}

const balance = (pos: Chess, attacker: Color) =>
	material(pos, attacker) - material(pos, attacker === 'white' ? 'black' : 'white');

/**
 * Moves worth considering when the question is about one square.
 *
 * Everything else is noise for this purpose, and including it turns a bounded
 * look-ahead into a chess engine. What survives:
 *
 *  - captures (the knot itself, and anything that changes who is left)
 *  - checks (the tempo-gaining defence that broke the previous model)
 *  - moves that put a piece where it bears on the square, or take one away
 *  - moves of the piece standing on the square
 */
function relevant(pos: Chess, target: Square, cap = 16): { from: Square; to: Square }[] {
	const scored: { from: Square; to: Square; rank: number }[] = [];

	for (const [from, tos] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const bearsNow = attacks(piece, from, pos.board.occupied).has(target);

		for (const to of tos) {
			const taken = pos.board.get(to);
			let rank = -1;

			if (taken) rank = 1000 + VALUE[taken.role];
			else if (from === target) rank = 900; // the prize moving
			else {
				// Does it start bearing on the square, or stop?
				const after = pos.board.clone();
				after.take(from);
				after.set(to, piece);
				const bearsAfter = attacks(piece, to, after.occupied).has(target);
				if (bearsAfter && !bearsNow) rank = 800;
				else if (!bearsAfter && bearsNow) rank = 500;
				else {
					// A check is relevant whatever it touches: it is the move that
					// buys a tempo, which is the thing this exists to model.
					const test = pos.clone();
					try {
						test.play({ from, to });
						if (test.isCheck()) rank = 700;
					} catch {
						/* not playable; leave it out */
					}
				}
			}

			if (rank >= 0) scored.push({ from, to, rank });
		}
	}

	scored.sort((a, b) => b.rank - a.rank);
	return scored.slice(0, cap).map(({ from, to }) => ({ from, to }));
}

/**
 * What the position settles at if nothing further is prepared.
 *
 * Two terms, and both had to be learned:
 *
 * **The mover takes what is free.** Obvious, and it was the whole of the first
 * version — which made every race come out at zero, because standing pat does
 * not stop the OPPONENT.
 *
 * **Otherwise the opponent collects.** Also necessary, and on its own it is
 * equally wrong: the second version dropped the mover's own captures and
 * reported that Black wins a rook in a position where the knight that was
 * going to take it can simply be captured first.
 *
 * So: if I have something to take, I take it; if I do not, they collect what
 * they were threatening. Both gains are exchange-resolved by `bestCapture`, so
 * this is a fold at a leaf, not a guess.
 */
function settled(node: Chess, attacker: Color, base: number): number {
	let mineGain = 0;
	try {
		mineGain = bestCapture(node)?.gain ?? 0;
	} catch {
		/* nothing to take */
	}

	let theirs = 0;
	if (mineGain <= 0) {
		const idle = node.clone();
		idle.turn = node.turn === 'white' ? 'black' : 'white';
		try {
			theirs = bestCapture(idle)?.gain ?? 0;
		} catch {
			// Flipping the turn where that is illegal — a king left in check —
			// throws rather than lying about it.
		}
	}

	const forMover = mineGain > 0 ? mineGain : -theirs;
	const mine = node.turn === attacker;
	return balance(node, attacker) - base + (mine ? forMover : -forMover);
}

/**
 * Alternating search over those moves only.
 *
 * Either side may stop at any point — "stand pat" — because neither is obliged
 * to keep pushing a plan that has stopped paying. That is the same option the
 * exchange fold gives each side at each capture, one level up.
 */
export function race(
	pos: Chess,
	target: Square,
	attacker: Color,
	plies = 4,
): RaceResult {
	const base = balance(pos, attacker);
	let truncated = false;

	// Alpha-beta, because this runs on every edit of the board and the plain
	// minimax was 215ms — long enough to be felt while dragging a piece. The
	// window is on material, so the cutoffs are exact rather than heuristic:
	// nothing is discarded that could have changed the answer.
	const search = (
		node: Chess,
		depth: number,
		alpha: number,
		beta: number,
	): { value: number; line: string[] } => {
		const forAttacker = node.turn === attacker;
		const standPat = settled(node, attacker, base);

		if (depth === 0) {
			truncated = true;
			return { value: standPat, line: [] };
		}

		let best = { value: standPat, line: [] as string[] };
		let a = alpha;
		let b = beta;
		if (forAttacker) a = Math.max(a, standPat);
		else b = Math.min(b, standPat);

		for (const m of relevant(node, target)) {
			if (a >= b) break;

			const next = node.clone();
			try {
				next.play(m);
			} catch {
				continue;
			}
			const sub = search(next, depth - 1, a, b);
			const better = forAttacker ? sub.value > best.value : sub.value < best.value;
			if (better) {
				best = {
					value: sub.value,
					line: [`${makeSquare(m.from)}${makeSquare(m.to)}`, ...sub.line],
				};
				if (forAttacker) a = Math.max(a, sub.value);
				else b = Math.min(b, sub.value);
			}
		}
		return best;
	};

	const out = search(pos, plies, -Infinity, Infinity);
	return { value: out.value, line: out.line, plies, truncated };
}
