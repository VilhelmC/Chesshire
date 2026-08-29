// MOBILIZATION DEFICIENCY — "that exchange is not worth walking toward."
//
// ---------------------------------------------------------------------------
// Will's words, and the reason this is on §4's list at all:
//
//   "mobilization deficiency (when an exchange is not worth mobilizing toward
//    (committing attackers or defenders)), because ultimately one player can
//    muster the winning exchange participants"
//
// SEE answers "who wins this square RIGHT NOW". It has nothing to say about the
// question a learner is actually stuck on, which is whether it is worth spending
// three moves bringing a rook to bear on f7. The men who decide that exchange
// are not on the squares they will fight from yet.
//
// So: `reach.ts`'s `bear(board, from, to)` — FORMALISM §5's d(p, S), plies until
// a man ATTACKS a square rather than reaches it — gives every piece on the board
// an arrival time at S. Sort both sides by arrival, and the exchange at S is a
// function of a HORIZON: who has got there by then.
//
//     horizon 0    the exchange SEE already reports
//     horizon 1    plus whoever can bear on S in one move
//     horizon t    plus everyone slower
//
// A square is DEFICIENT when that number never turns positive, at any horizon.
// We can keep sending men and they can keep answering, so the whole project is
// not worth beginning — which is a statement about plans, and the only overlay
// on §4's list that is.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO THEME AND NO PERCENTAGE HERE.
//
// Lichess has no `mobilization` theme, so this cannot be scored the way forks
// and pins were. It does not need to be, and claiming a percentage would be
// worse than having none: GIVEN THE PARTICIPANT SETS, THE ANSWER IS EXACT. The
// swap sequence below is the standard single-square exchange recurrence, which
// `AMEND-RUNG-ORDER.md`'s opt-out bound showed is exact for one square — nobody
// recaptures into a loss, so the value never exceeds the man standing there.
//
// What is NOT exact is the arrival times, and that is where this can be wrong:
// `bear` walks one man on a frozen board, so it cannot know that the route will
// be blocked, or that the opponent will not simply spend their moves elsewhere.
// A horizon is an upper bound on what could arrive, not a schedule.
//
// The gate is therefore a FALSIFICATION TEST rather than a label — the shape
// `safeMoves` ended up with. `scripts/m5-muster-gate.mjs` takes every position
// where the corpus's own verified answer wins material ON THAT SQUARE (not
// merely somewhere in the line, which was the first version's mistake and which
// counted every intermezzo as a contradiction), and asks whether this had called
// that square deficient.
//
// WHAT IT FOUND, in order:
//
//   80.17%  the swap's signs were inverted. It valued an undefended rook at
//           minus five pawns. The first run of the gate reported 0.00% falsified
//           and looked like a pass, because a separate bug in the gate's own
//           sacrifice classifier was swallowing all 275 contradictions — a gate
//           that reports a perfect score is a reason to check the gate.
//    2.92%  after the recurrence was rewritten as a recurrence.
//    1.46%  after the falsifier stopped crediting a whole line's net to one
//           square.
//    0.87%  after the king was allowed to capture (`Kxe2`, `Kxh8`).
//
// The three that remain are the single-square limit that `settled` already
// names: the value AT the square is 3.20, 1.00 and 1.00, and the material that
// makes those moves good arrives from somewhere else.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Color, Role, Square } from 'chessops/types';
import { attacks } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import { makeSquare } from 'chessops/util';
import type { Board } from 'chessops/board';
import { V, other } from '../exchange';
import { bear, reach } from '../reach';
import type { Mark } from './core';

/** One man, and when it can bear on the square. */
export type Arrival = { from: Square; at: number; role: Role; value: number };

export type Muster = {
	square: Square;
	/** What is standing there. */
	prize: number;
	ours: Arrival[];
	theirs: Arrival[];
	/** The best the square is worth to us, over every horizon. */
	best: number;
	/** The horizon at which `best` first happens. Infinity if it never does. */
	bestAt: number;
	/**
	 * We can bring men and it still never pays. The overlay's whole sentence.
	 */
	deficient: boolean;
};

/**
 * The exchange at a square, given exactly these participants.
 *
 * The standard swap recurrence: both sides bring their least valuable man first,
 * and either may stop at any point. `gain[d]` is what the side to move at depth
 * d gets by continuing; folding back with the max is the opt-out, which is what
 * makes the result a real bound rather than a forced sequence.
 *
 * Taken as a value list rather than off a board, because the men whose arrival
 * times put them in this exchange are not standing on their fighting squares
 * yet. That is the entire difference between this and `see`.
 */
export function swap(prize: number, ours: number[], theirs: number[]): number {
	// Least valuable first: taking with the pawn keeps the rook for the next one.
	const a = [...ours].sort((x, y) => x - y);
	const b = [...theirs].sort((x, y) => x - y);

	// WRITTEN AS THE RECURRENCE AND NOT AS THE ARRAY FOLD, deliberately.
	//
	// The first version was the classic gain[]/fold-back formulation and its
	// signs were inverted: it valued a completely undefended rook at MINUS five
	// pawns. `scripts/m5-muster-gate.mjs` caught it by contradiction against the
	// corpus — 275 positions where the puzzle's own verified answer captures on a
	// square this had called unwinnable.
	//
	// The fold is a well-known optimisation of exactly this recursion, and it is
	// not worth the risk here: the lists are at most a handful long, this is not
	// in any search's inner loop, and a formulation whose correctness has to be
	// argued is how the sign got lost in the first place.
	//
	// `Math.max(0, …)` at every level is the opt-out, and it is the rule of chess
	// rather than an approximation: nobody is obliged to capture. It is the same
	// stand-pat that `quiesce` rests on, for the same reason.
	const go = (occupant: number, us: number[], them: number[]): number => {
		if (!us.length) return 0;
		const [taker, ...rest] = us;
		// Take what is standing there; they may then answer, and what they win
		// comes straight off the top.
		return Math.max(0, occupant - go(taker, them, rest));
	};
	return go(prize, a, b);
}

/**
 * Who can bring what to bear on `square`, and what the exchange is worth at
 * every horizon out to `horizon`.
 */
export function muster(board: Board, square: Square, us: Color, horizon = 3): Muster {
	const them = other(us);
	const prizePiece = board.get(square);
	const prize = prizePiece && prizePiece.role !== 'king' ? V[prizePiece.role] : 0;

	const gather = (side: Color): Arrival[] => {
		const out: Arrival[] = [];
		for (const from of board[side]) {
			if (from === square) continue;
			const piece = board.get(from);
			if (!piece || piece.role === 'king') continue;
			// Zero first, because it is free: most men either already bear on the
			// square or are nowhere near it, and the walk is only for the rest.
			const now = attacks(piece, from, board.occupied).has(square);
			const at = now ? 0 : bear(board, from, square, reach(board, from, { limit: horizon }));
			if (at > horizon) continue;
			out.push({ from, at, role: piece.role, value: V[piece.role] });
		}
		return out.sort((x, y) => x.at - y.at || x.value - y.value);
	};

	const ours = gather(us);
	const theirs = gather(them);

	// THE KING IS LEFT OUT OF THE SWAP AND PUT BACK FOR THE FIRST CAPTURE.
	//
	// It cannot be spent, so it has no place in a sequence that trades men off —
	// arithmetic that lets a king be taken is about a position that cannot happen.
	// But it can still CAPTURE, and leaving it out of that was a real error the
	// falsifier caught: two of five contradictions were `Kxe2` and `Kxh8` on
	// squares this had called unwinnable because the king was not counted.
	//
	// The rule is the ordinary one and it is exact: the king may take only when
	// nothing answers, and once it has taken there is nothing to recapture with,
	// so the exchange ends there and the value is simply the prize.
	const kingOurs = board.kingOf(us);
	const kingBears =
		kingOurs !== undefined && attacks({ role: 'king', color: us }, kingOurs, board.occupied).has(square);

	let best = -Infinity;
	let bestAt = Infinity;
	for (let t = 0; t <= horizon; t++) {
		const a = ours.filter((x) => x.at <= t);
		const d = theirs.filter((x) => x.at <= t);
		if (!a.length && !(kingBears && !d.length)) continue;
		const v =
			kingBears && !d.length
				? prize
				: swap(
						prize,
						a.map((x) => x.value),
						d.map((x) => x.value),
					);
		if (v > best) {
			best = v;
			bestAt = t;
		}
	}
	if (best === -Infinity) {
		best = 0;
		bestAt = Infinity;
	}

	return {
		square,
		prize,
		ours,
		theirs,
		best,
		bestAt,
		// We CAN send men — otherwise there is no plan to call deficient — and it
		// still never pays.
		deficient: (ours.length > 0 || kingBears) && best <= 0,
	};
}

/**
 * The squares worth something that we cannot win however many men we send.
 *
 * Only enemy men are considered: an empty square has no prize, so "deficient"
 * there is a statement about space rather than material and this overlay does
 * not make it.
 */
export function deficiencies(pos: Chess, horizon = 3, minPrize = V.knight): Muster[] {
	const us = pos.turn;
	const board = pos.board;
	// Only squares we could plausibly contest. Everything else is not a plan
	// anybody was considering, and listing it would be the decoration failure in
	// its purest form.
	let reachable = SquareSet.empty();
	for (const from of board[us]) {
		const p = board.get(from);
		if (p) reachable = reachable.union(attacks(p, from, board.occupied));
	}
	const out: Muster[] = [];
	for (const square of board[other(us)].intersect(reachable)) {
		const piece = board.get(square);
		if (!piece || piece.role === 'king') continue;
		// THE THRESHOLD IS THE WHOLE DIFFERENCE BETWEEN A DETECTOR AND A
		// DECORATION, measured rather than chosen. `scripts/m5-muster-gate.mjs`:
		//
		//   any prize          fires on 39.5% of plies   0.53 squares per position
		//   knight or better   fires on  9.9% of plies   0.10 squares per position
		//   rook or better     fires on  2.7% of plies   0.03 squares per position
		//
		// PLAN-EXPLAINER §4 names 40% as the line, and "any prize" sits exactly on
		// it — because "you cannot win that defended pawn" is true of half the board
		// and is a statement about chess rather than about the position. The default
		// matches `forks`' own `minGain`, and for the same reason.
		if (V[piece.role] < minPrize) continue;
		const m = muster(board, square, us, horizon);
		if (m.deficient) out.push(m);
	}
	return out;
}

/**
 * The squares that DO pay, once enough men are brought.
 *
 * ---------------------------------------------------------------------------
 * NOT AN OVERLAY, AND NOT A CLAIM. This is the evidence that the horizon does
 * something — 4.39 squares per position across 90.7% of positions, which is what
 * SEE alone cannot report — and it is deliberately not drawn.
 *
 * The reason is that the falsification gate does not test it and structurally
 * cannot. `deficiencies` makes a NEGATIVE claim ("this cannot be won"), which a
 * winning move contradicts and the corpus is full of winning moves. This makes a
 * POSITIVE one ("bring two more men and it falls"), which nothing in the corpus
 * refutes: a puzzle not playing a plan is not evidence the plan fails.
 *
 * And it is visibly optimistic. On `r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/
 * R2Q1RK1 w` it offers "f6 +900 at t=2" — the enemy QUEEN, which will not stand
 * still for two plies while we walk toward it. `bear` walks one man on a frozen
 * board, so a horizon is an upper bound on what could arrive, never a schedule.
 *
 * Kept, exported and tested because deleting it would delete the measurement
 * that justifies the horizon. Drawn on a board, it would be a lie.
 * ---------------------------------------------------------------------------
 */
export function worthMobilising(pos: Chess, horizon = 3, minPrize = V.knight): Muster[] {
	const us = pos.turn;
	const board = pos.board;
	const out: Muster[] = [];
	for (const square of board[other(us)]) {
		const piece = board.get(square);
		if (!piece || piece.role === 'king' || V[piece.role] < minPrize) continue;
		const m = muster(board, square, us, horizon);
		// It does not pay NOW but it does with more men — the interesting case, and
		// the one SEE alone cannot report. Measured at 4.39 squares per position
		// across 90.7% of positions before the threshold, which is the evidence
		// that the horizon is doing work rather than reproducing SEE.
		if (m.best > 0 && m.bestAt > 0) out.push(m);
	}
	return out;
}

// ---------------------------------------------------------------------------

/** Turn a muster into something drawable. */
export function musterMark(m: Muster): Mark {
	const men = m.ours.map((a) => a.from);
	if (m.deficient)
		return {
			squares: [m.square, ...men],
			note: `${makeSquare(m.square)} cannot be won — they can always answer`,
		};
	return {
		squares: [m.square, ...m.ours.filter((a) => a.at <= m.bestAt).map((a) => a.from)],
		note: `${makeSquare(m.square)} falls once ${m.bestAt} more ${m.bestAt === 1 ? 'move brings' : 'moves bring'} up support`,
	};
}
