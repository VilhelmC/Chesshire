// The contest at a square.
//
// ---------------------------------------------------------------------------
// See EXPLOITABILITY.md. In one paragraph: a pin, a fork, a skewer and "attack
// it again" are not four things. They are one calculation — who can bring what
// to bear on a square, in how many moves, at what cost, and whether the prize
// can simply leave. Static exchange evaluation answers that question for the
// units ALREADY in contact. This extends it over arrival time and escape, which
// are the two columns that decide whether a pin is worth a tempo or a waste of
// one.
//
// Everything here is a pure function of a FEN. Nothing searches. The output is
// deliberately verbose — every unit, every route, every step of every fold —
// because the Lab tab exists so a human can check the arithmetic rather than
// take an assertion, and a function that returns only its verdict cannot be
// checked at all.
//
// The known approximations are listed in EXPLOITABILITY.md §7 and surfaced in
// the UI. The most important: routes are computed on a frozen board, and the
// defender is assumed to spend their tempi defending — which makes "winnable"
// sound and "not winnable" merely indicative.
// ---------------------------------------------------------------------------

import { attacks, between, ray } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Square, Color, Role, Piece } from 'chessops/types';
import type { Board } from 'chessops/board';
import { positionFromFen, makeSquare, parseSquare } from './chess';
import type { Chess } from 'chessops/chess';
import { replies, bestCapture, type Reply, type Capture } from './reply';
import { race, type RaceResult } from './race';

/** Centipawns. The king is priced so it never enters a fold as a target. */
export const VALUE: Record<Role, number> = {
	pawn: 100,
	knight: 320,
	bishop: 330,
	rook: 500,
	queen: 900,
	king: 100000,
};

export type Unit = {
	/** Where it stands now. */
	from: string;
	role: Role;
	colour: Color;
	value: number;
	/** Moves by its own side before it bears on the target. 0 = already does. */
	arrival: number;
	/** The square it must reach to bear on the target, when arrival > 0. */
	via?: string;
	/** What the journey costs, in centipawns, by the fold at each landing square. */
	routeCost: number;
	/** Zero when the unit cannot legally move at all (absolute pin). */
	available: boolean;
	/**
	 * What this unit is already doing that joining here would abandon.
	 *
	 * The whole content of "overloaded", as a number rather than a name: simulate
	 * the unit going where it must go, and see what the other side then wins
	 * somewhere else. A knight that can defend this square but is the only guard
	 * of a bishop across the board is not a defender of this square — it is a
	 * choice between two contests, which is a fork with the two prongs separated
	 * in space and time rather than sharing one attacker.
	 */
	duty: number;
	/** Where that duty is. */
	dutyAt?: string;
	note?: string;
};

export type FoldStep = {
	/** Who is capturing. */
	colour: Color;
	from: string;
	role: Role;
	/** Value of the piece taken off. */
	captured: number;
	/**
	 * What the side to move here gets by capturing and playing on optimally.
	 *
	 * This is the number that decides whether the step happens at all, and it is
	 * shown because "the sequence stops here" is a claim the reader should be
	 * able to check rather than accept.
	 */
	gain: number;
	/** False once continuing costs more than stopping. */
	happens: boolean;
};

export type Fold = {
	/** Attacker's point of view, in centipawns. Never negative: nobody is forced. */
	value: number;
	/** The speculative sequence, cheapest attacker first, both sides recapturing. */
	steps: FoldStep[];
	/** How many of those captures actually happen. */
	depth: number;
};

export type Escape = {
	to: string;
	/** Material the move itself loses at the destination, by the fold there. */
	cost: number;
	/** Material exposed elsewhere by leaving — the relative-pin term. */
	exposes: number;
	/**
	 * What the escaping piece threatens from where it lands, after the opponent's
	 * best single reply.
	 *
	 * Without this the procedure calls every departure that exposes a queen a
	 * pin, which is wrong exactly when it matters: a knight that steps off the
	 * pin WITH a fork is not losing a queen, it is trading one. The threat is
	 * only counted when it survives the opponent's best reply — a potential fork
	 * that one move dissolves compels nobody.
	 */
	counter: number;
	/** cost + exposes − counter. Zero or less means a free escape. */
	total: number;
	/**
	 * False when exposure and counter-threat are both material, so the position
	 * is a sequence to calculate rather than a number to read.
	 */
	resolved: boolean;
};

export type ContestRow = {
	/** Build-up depth: moves each side has spent before the attacker initiates. */
	k: number;
	attackers: Unit[];
	defenders: Unit[];
	fold: Fold;
	/** Route costs paid to reach this row, subtracted from the fold. */
	spent: number;
	/** Fold minus what the build-up cost. */
	net: number;
	/**
	 * Defenders the fold actually depends on AND that owe their presence
	 * elsewhere — measured by re-running the fold with the unit off the board,
	 * not inferred.
	 */
	critical: { unit: Unit; foldWithout: number }[];
	/**
	 * The build-up move this row proposes, and what happens after the defender's
	 * best answer to it.
	 *
	 * Null at k = 0, where the attacker simply takes and the defender never gets
	 * a move. From k = 1 this is the row's real content: the fold above is what
	 * the exchange WOULD pay, and this is what survives a defence.
	 */
	play?: {
		move: { from: string; to: string };
		/** Their best answer, and what it still concedes. */
		defence: Reply | null;
		/** What the attacker gets after that answer. The honest number. */
		survives: number;
	};
};

export type Contest = {
	target: string;
	/** What stands on the target square, if anything. */
	prize: { role: Role; colour: Color; value: number } | null;
	/** The side trying to win the prize. */
	attacker: Color;
	/** Whose move it actually is — part of the question, not a detail. */
	turn: Color;
	/**
	 * The race for the square: both sides mobilising, tempo by tempo.
	 *
	 * This is the verdict's source of truth. The tables below it explain the
	 * answer — who can reach the square, what the exchange folds to, what each
	 * defender owes elsewhere — but the answer itself comes from playing the
	 * race out, because a count cannot price a tempo.
	 */
	race: RaceResult;
	rows: ContestRow[];
	/**
	 * Where the prize can go, and what going there costs it.
	 *
	 * Display only, now. Leaving is one of the defender's legal replies and is
	 * counted there; this table remains because "it can step to f6 for nothing"
	 * is a useful thing to read, not because any verdict rests on it.
	 */
	escapes: Escape[];
	/** The cheapest escape's total cost. Null when there is no escape at all. */
	escapeCost: number | null;
	/** Smallest k whose net is positive AND from which the prize cannot walk. */
	winnableAt: number | null;
	/**
	 * What the table amounts to, including the two answers that are not a number.
	 *
	 * 'entangled' — the defence holds only because of a unit that owes its
	 * presence somewhere else; the position is a choice between two contests.
	 * 'unresolved' — the prize can leave into a counter-threat, so this is a
	 * sequence to calculate and the procedure declines to price it.
	 */
	verdict: {
		kind: 'winnable' | 'not-winnable' | 'entangled' | 'unresolved';
		at?: number;
		why: string;
	};
	/** Everything the caller must not forget while reading the above. */
	caveats: string[];
};

/** Chessops squares are numbers; the rest of the app speaks algebraic. */
const sq = (s: Square) => makeSquare(s);

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/**
 * Every piece of `colour` currently bearing on `target`.
 *
 * Sliders stop at the first occupied square, and that square is included — so a
 * queen behind a knight on the same file counts as bearing on the knight's
 * square, which is correct: it captures whatever lands there. Recomputing this
 * after each capture is what makes x-rays fall out of the fold rather than
 * needing their own case.
 */
export function bearingOn(board: Board, target: Square, colour: Color, occupied: SquareSet): Square[] {
	const out: Square[] = [];
	for (const from of board[colour].intersect(occupied)) {
		const piece = board.get(from);
		if (!piece) continue;
		if (attacks(piece, from, occupied).has(target)) out.push(from);
	}
	return out;
}

/**
 * Pieces that cannot legally leave the line they stand on, and where they may
 * still go.
 *
 * A pinned piece is not a defender. The fold is arithmetic on a board and knows
 * nothing about legality, so without this a pawn pinned to its own king happily
 * "recaptures" and the count reports a defended piece where the piece is free.
 *
 * Returned as the squares the pinned piece may still move to — the ray between
 * the pinning slider and the king, plus the slider itself — because a piece
 * pinned along a file can still capture ALONG that file.
 */
export function pinnedOn(board: Board, colour: Color): Map<Square, SquareSet> {
	const out = new Map<Square, SquareSet>();
	const king = board.kingOf(colour);
	if (king === undefined) return out;

	for (const from of board[other(colour)]) {
		const piece = board.get(from);
		if (!piece || (piece.role !== 'rook' && piece.role !== 'bishop' && piece.role !== 'queen')) {
			continue;
		}
		// Aligned with the king, and aligned the way this piece moves.
		const line = ray(from, king);
		if (line.isEmpty()) continue;
		if (!attacks(piece, from, SquareSet.empty()).has(king)) continue;

		const bt = between(from, king);
		const blockers = bt.intersect(board.occupied);
		if (blockers.size() !== 1) continue;

		const blocker = blockers.first();
		if (blocker === undefined || !board[colour].has(blocker)) continue;

		out.set(blocker, bt.with(from));
	}
	return out;
}

/**
 * The exchange fold at a square: cheapest attacker first, either side free to
 * stop when continuing would lose.
 *
 * Static exchange evaluation, written out step by step. The recurrence is the
 * standard swap-off one, and getting it wrong is easy in a way that still looks
 * arithmetically plausible — my first version backed the min-max up from the
 * attacker's point of view at every step, which let the attacker "stop" AFTER
 * capturing and so reported a free piece where the recapture wins. It is stated
 * here as one line so that error cannot hide:
 *
 *     S(j) = max( 0, value_captured(j) − S(j+1) )
 *
 * Read: the side to move at step j either declines (0) or takes what is there
 * and concedes whatever the opponent then makes of the square. Every step gets
 * the option to decline, which is why the value is never negative — nobody is
 * ever forced into an exchange.
 */
export function foldAt(
	board: Board,
	target: Square,
	attacker: Color,
	opts: { extraAttackers?: Square[]; extraDefenders?: Square[] } = {},
): Fold {
	const prize = board.get(target);
	if (!prize) return { value: 0, steps: [], depth: 0 };

	let occupied = board.occupied;
	let onSquare = VALUE[prize.role];
	let side = attacker;

	// Computed once, from the starting position. Recomputing after each capture
	// would be more exact — a pin can be created or broken mid-chain — and it is
	// not worth the cost here; the common case is a pin that exists before the
	// exchange starts and persists through it.
	const pinned = {
		white: pinnedOn(board, 'white'),
		black: pinnedOn(board, 'black'),
	};

	/** Which rank does a pawn of this colour promote on? */
	const lastRank = (c: Color) => (c === 'white' ? 7 : 0);

	// Units counted at this row of the table although not yet in contact. They
	// join as if they already bore on the square.
	const extra = new Map<Square, Color>();
	for (const s of opts.extraAttackers ?? []) extra.set(s, attacker);
	for (const s of opts.extraDefenders ?? []) extra.set(s, other(attacker));

	// The speculative sequence: keep capturing while anyone can.
	const seq: { colour: Color; from: Square; role: Role; captured: number }[] = [];

	for (let i = 0; i < 32; i++) {
		const inContact = bearingOn(board, target, side, occupied);
		const joined = [...extra.entries()]
			.filter(([s, c]) => c === side && occupied.has(s))
			.map(([s]) => s);
		const candidates = [...new Set([...inContact, ...joined])]
			.filter((s) => s !== target)
			// A piece pinned to its own king may only act along the pin. Leaving
			// it in makes a defended piece out of a free one.
			.filter((s) => {
				const allowed = pinned[side].get(s);
				return !allowed || allowed.has(target);
			});
		if (!candidates.length) break;

		// Cheapest first. Taking with the queen when a pawn will do is how a fold
		// produces a wrong answer that looks arithmetically fine.
		let best: Square | null = null;
		let bestValue = Infinity;
		for (const s of candidates) {
			const p = board.get(s);
			if (!p) continue;
			const v = VALUE[p.role];
			if (v < bestValue) {
				bestValue = v;
				best = s;
			}
		}
		if (best === null) break;
		const piece = board.get(best) as Piece;

		// A pawn that captures onto the last rank arrives as a queen: it wins
		// what it took AND the difference in its own value, and the piece the
		// opponent must now deal with is a queen. Leaving this out prices a
		// promoting capture as an ordinary one, which is wrong by eight pawns.
		const promotes = piece.role === 'pawn' && (target >> 3) === lastRank(side);
		const bonus = promotes ? VALUE.queen - VALUE.pawn : 0;

		seq.push({ colour: side, from: best, role: piece.role, captured: onSquare + bonus });

		// The capturer now stands on the square and is itself the next prize.
		onSquare = promotes ? VALUE.queen : VALUE[piece.role];
		occupied = occupied.without(best);
		extra.delete(best);
		side = other(side);
	}

	// Back up the recurrence from the tail.
	const gains: number[] = new Array(seq.length + 1).fill(0);
	for (let j = seq.length - 1; j >= 0; j--) {
		gains[j] = Math.max(0, seq[j].captured - gains[j + 1]);
	}

	// Walk forward to see how much of the sequence is actually played: a step
	// happens only if the step before it happened and taking beats declining.
	let depth = 0;
	for (let j = 0; j < seq.length; j++) {
		if (seq[j].captured - gains[j + 1] <= 0) break;
		depth = j + 1;
	}

	const steps: FoldStep[] = seq.map((s, j) => ({
		colour: s.colour,
		from: sq(s.from),
		role: s.role,
		captured: s.captured,
		gain: gains[j],
		happens: j < depth,
	}));

	return { value: gains[0], steps, depth };
}

/**
 * The best capture `side` has anywhere on the board, by the fold at each square.
 *
 * Used to price what a unit is already doing: move it, ask this again, and the
 * difference is the duty it was carrying.
 */
export function bestGainFor(
	board: Board,
	side: Color,
	opts: { exclude?: Square; onlyAttackedBy?: Square } = {},
): { square: string; value: number } | null {
	// Restricting to one piece's own targets is what separates "this move
	// creates a threat" from "a threat exists somewhere on the board", which are
	// very different claims and were briefly the same line of code.
	const attacker = opts.onlyAttackedBy !== undefined ? board.get(opts.onlyAttackedBy) : null;
	const reach =
		attacker && opts.onlyAttackedBy !== undefined
			? attacks(attacker, opts.onlyAttackedBy, board.occupied)
			: null;

	let best: { square: string; value: number } | null = null;
	for (const s of board[other(side)]) {
		if (s === opts.exclude) continue;
		if (reach && !reach.has(s)) continue;
		const f = foldAt(board, s, side);
		if (f.value > 0 && (!best || f.value > best.value)) {
			best = { square: sq(s), value: f.value };
		}
	}
	return best;
}

/**
 * What it costs this unit, elsewhere, to take part here.
 *
 * Simulated as the move it would actually make — not as vanishing from the
 * board, which is a perturbation the game cannot perform and would price the
 * wrong thing. A unit already in contact is simulated as being captured, since
 * that is how it leaves in a fold.
 */
export function dutyOf(
	board: Board,
	from: Square,
	via: Square | null,
	/** The contest being analysed. Excluded, or every defender is reported as
	 *  the sole guard of the square it is defending — true, circular, useless. */
	exclude?: Square,
): { value: number; at?: string } {
	const piece = board.get(from);
	if (!piece) return { value: 0 };

	const before = bestGainFor(board, other(piece.color), { exclude })?.value ?? 0;

	const after = board.clone();
	after.take(from);
	if (via !== null) {
		const taken = after.get(via);
		if (taken) after.take(via);
		after.set(via, piece);
	}

	const then = bestGainFor(after, other(piece.color), { exclude });
	const value = Math.max(0, (then?.value ?? 0) - before);
	return value > 0 && then ? { value, at: then.square } : { value: 0 };
}

/** Squares a piece could move to, on a frozen board. Pseudo-legal. */
export function destinations(board: Board, from: Square): Square[] {
	const piece = board.get(from);
	if (!piece) return [];
	const own = board[piece.color];

	if (piece.role === 'pawn') {
		const out: Square[] = [];
		const dir = piece.color === 'white' ? 8 : -8;
		const one = from + dir;
		if (one >= 0 && one < 64 && !board.occupied.has(one as Square)) {
			out.push(one as Square);
			const startRank = piece.color === 'white' ? 1 : 6;
			const two = from + dir * 2;
			if ((from >> 3) === startRank && !board.occupied.has(two as Square)) {
				out.push(two as Square);
			}
		}
		// Captures only where there is something to take.
		for (const s of attacks(piece, from, board.occupied)) {
			if (board[other(piece.color)].has(s)) out.push(s);
		}
		return out;
	}

	return [...attacks(piece, from, board.occupied)].filter((s) => !own.has(s));
}

/**
 * Units that can bring themselves to bear on the target, and how long it takes.
 *
 * Breadth-first over moves on a FROZEN board — nothing else moves while this
 * piece travels. That is wrong in both directions (routes open, routes close)
 * and is the first approximation to distrust; it is listed as a caveat and shown
 * in the UI rather than buried.
 */
export function arrivals(pos: Chess, target: Square, colour: Color, maxTempi = 2): Unit[] {
	const board = pos.board;
	const out: Unit[] = [];

	for (const from of board[colour]) {
		// The prize is not a defender of its own square. Without this the knight
		// under attack was listed as arriving in one move to defend itself, via a
		// square it can only reach by abandoning the contest — an absurdity the
		// Lab showed on its first run and no unit test of mine had asked about.
		if (from === target) continue;
		const piece = board.get(from);
		if (!piece || piece.role === 'king') continue;

		if (attacks(piece, from, board.occupied).has(target)) {
			const duty = dutyOf(board, from, null, target);
			out.push({
				from: sq(from),
				role: piece.role,
				colour,
				value: VALUE[piece.role],
				arrival: 0,
				routeCost: 0,
				available: canMove(pos, from),
				duty: duty.value,
				...(duty.at ? { dutyAt: duty.at } : {}),
				...(canMove(pos, from) ? {} : { note: 'pinned — cannot move' }),
			});
			continue;
		}

		const found = search(board, from, piece, target, maxTempi);
		if (found) {
			const duty = dutyOf(board, from, found.via, target);
			out.push({
				from: sq(from),
				role: piece.role,
				colour,
				value: VALUE[piece.role],
				arrival: found.tempi,
				via: sq(found.via),
				routeCost: found.cost,
				available: canMove(pos, from),
				duty: duty.value,
				...(duty.at ? { dutyAt: duty.at } : {}),
				...(canMove(pos, from) ? {} : { note: 'pinned — cannot move' }),
			});
		}
	}

	// Cheapest first, soonest first — the order the fold will want them in.
	return out.sort((a, b) => a.arrival - b.arrival || a.value - b.value);
}

/** Shortest route to a square from which `piece` bears on `target`. */
function search(
	board: Board,
	from: Square,
	piece: Piece,
	target: Square,
	maxTempi: number,
): { tempi: number; via: Square; cost: number } | null {
	type Node = { at: Square; tempi: number; cost: number };
	const seen = new Set<Square>([from]);
	let frontier: Node[] = [{ at: from, tempi: 0, cost: 0 }];

	for (let depth = 1; depth <= maxTempi; depth++) {
		const next: Node[] = [];
		for (const node of frontier) {
			// Move the piece to `node.at` on a scratch board so its moves from
			// there are generated against a realistic occupancy.
			const scratch = board.clone();
			scratch.take(from);
			scratch.set(node.at, piece);

			for (const to of destinations(scratch, node.at)) {
				if (seen.has(to)) continue;
				seen.add(to);

				// What standing there costs: the fold at that square with this
				// piece on it. A route through a square that loses a pawn is
				// priced at a pawn, not forbidden — see EXPLOITABILITY.md §4.1.
				const landed = scratch.clone();
				landed.take(node.at);
				const taken = landed.get(to);
				if (taken) landed.take(to);
				landed.set(to, piece);
				const reply = foldAt(landed, to, other(piece.color));
				const cost = node.cost + Math.max(0, reply.value) - (taken ? VALUE[taken.role] : 0);

				if (attacks(piece, to, landed.occupied).has(target)) {
					return { tempi: depth, via: to, cost };
				}
				next.push({ at: to, tempi: depth, cost });
			}
		}
		frontier = next;
	}
	return null;
}

/** Can this piece legally move at all? False means an absolute pin. */
function canMove(pos: Chess, from: Square): boolean {
	try {
		// dests() is only defined for the side to move, so ask a mirrored
		// position when it is not their turn.
		const p = pos.board.get(from);
		if (!p) return false;
		const view = pos.clone();
		view.turn = p.color;
		return !view.dests(from).isEmpty();
	} catch {
		return true;
	}
}

/**
 * What a piece threatens from where it stands, after the opponent's best single
 * reply.
 *
 * This is the one part of the machinery that looks a move ahead, and it is
 * bounded to exactly one ply of THEIR moves, evaluated on the resulting board.
 * The reason it cannot be skipped: a threat the opponent dissolves with one
 * move compels nobody, and a detector that counts geometry rather than
 * compulsion fires on almost everything and means nothing.
 */
export function unrepairableThreat(pos: Chess, mover: Color, onlyAttackedBy?: Square): number {
	const free = bestGainFor(pos.board, mover, { onlyAttackedBy })?.value ?? 0;
	if (free <= 0) return 0;

	// It is the opponent's turn: they get one move to make it go away.
	const view = pos.clone();
	view.turn = other(mover);

	let worst = free;
	let replies = 0;
	for (const [from, tos] of view.allDests()) {
		for (const to of tos) {
			replies++;
			// A bounded sweep. The opponent's realistic repairs are captures,
			// blocks and moving the target; enumerating every legal move of a
			// full position is affordable here because the fold is cheap, but
			// it is capped so a Lab click cannot hang.
			if (replies > 220) return worst;
			const after = view.clone();
			try {
				after.play({ from, to });
			} catch {
				continue;
			}
			// The piece may have been captured by the repair, in which case its
			// threat is gone rather than merely reduced.
			const stillThere =
				onlyAttackedBy === undefined || after.board.get(onlyAttackedBy)?.color === mover;
			const left = stillThere
				? (bestGainFor(after.board, mover, { onlyAttackedBy })?.value ?? 0)
				: 0;
			if (left < worst) worst = left;
			if (worst <= 0) return 0;
		}
	}
	return worst;
}

/**
 * The best LEGAL capture on one square, with the exchange resolved.
 *
 * `foldAt` answers "what does this square cost", which is not the same question
 * as "may I take it" — a pinned attacker, or a king in check, makes the second
 * answer no while the first is unchanged.
 */
export function captureOn(pos: Chess, target: Square): Capture | null {
	const prize = pos.board.get(target);
	if (!prize) return null;

	let best: Capture | null = null;
	for (const [from, tos] of pos.allDests()) {
		if (!tos.has(target)) continue;
		const after = pos.clone();
		try {
			after.play({ from, to: target });
		} catch {
			continue;
		}
		const back = foldAt(after.board, target, after.turn);
		const gain = VALUE[prize.role] - back.value;
		if (!best || gain > best.gain) {
			best = { from: sq(from), to: sq(target), gain };
		}
	}
	return best;
}

/** Where the prize can run, and what running costs it. */
export function escapesFor(pos: Chess, target: Square): Escape[] {
	const piece = pos.board.get(target);
	if (!piece) return [];

	const view = pos.clone();
	view.turn = piece.color;
	let dests: SquareSet;
	try {
		dests = view.dests(target);
	} catch {
		return [];
	}

	const out: Escape[] = [];
	for (const to of dests) {
		const played = view.clone();
		try {
			played.play({ from: target, to });
		} catch {
			continue;
		}

		const landing = foldAt(played.board, to, other(piece.color));
		const taken = pos.board.get(to);
		const cost = Math.max(0, landing.value) - (taken ? VALUE[taken.role] : 0);

		// What leaving exposed: the opponent's best fold anywhere else on our
		// side, which is the relative-pin term without needing a separate idea.
		let exposes = 0;
		for (const s of played.board[piece.color]) {
			if (s === to) continue;
			const f = foldAt(played.board, s, other(piece.color));
			if (f.value > exposes) exposes = f.value;
		}

		// ...and what the piece threatens from where it landed. Only worth
		// asking when something was exposed; otherwise the escape is already
		// free and the answer changes nothing.
		// Only what THIS piece threatens from where it landed. A threat that was
		// already available is not compensation for anything — counting it made
		// an ordinary retreat look like a counterstroke.
		const counter = exposes > 0 ? unrepairableThreat(played, piece.color, to) : 0;

		// Both material means neither number is the answer: it is a sequence.
		const resolved = !(exposes > 0 && counter > 0);

		out.push({
			to: sq(to),
			cost,
			exposes,
			counter,
			total: cost + exposes - counter,
			resolved,
		});
	}
	return out.sort((a, b) => a.total - b.total);
}

/**
 * The whole contest at a square, as a table over build-up depth.
 *
 * `attacker` defaults to whoever does NOT own the prize.
 */
export function contest(fen: string, targetSquare: string, maxTempi = 2): Contest {
	const pos = positionFromFen(fen);
	const target = parseSquare(targetSquare);
	if (target === undefined) throw new Error(`not a square: ${targetSquare}`);

	const piece = pos.board.get(target);
	const prize = piece
		? { role: piece.role, colour: piece.color, value: VALUE[piece.role] }
		: null;
	const attacker: Color = piece ? other(piece.color) : pos.turn;

	const att = arrivals(pos, target, attacker, maxTempi);
	const def = arrivals(pos, target, other(attacker), maxTempi);
	const escapes = piece ? escapesFor(pos, target) : [];
	const escapeCost = escapes.length ? escapes[0].total : null;

	const rows: ContestRow[] = [];
	for (let k = 0; k <= maxTempi; k++) {
		const a = att.filter((u) => u.arrival <= k && u.available);
		const d = def.filter((u) => u.arrival <= k && u.available);

		const fold = prize
			? foldAt(pos.board, target, attacker, {
					extraAttackers: a
						.filter((u) => u.arrival > 0)
						.map((u) => parseSquare(u.from) as Square),
					extraDefenders: d
						.filter((u) => u.arrival > 0)
						.map((u) => parseSquare(u.from) as Square),
				})
			: { value: 0, steps: [], depth: 0 };

		const spent = a.filter((u) => u.arrival > 0).reduce((t, u) => t + u.routeCost, 0);

		// Which defenders is this row's answer actually resting on? Re-run the
		// fold with each one taken off the board. A defender whose absence does
		// not change the number is not holding anything, whatever duties it has
		// elsewhere — and a defender whose absence DOES change it, while being
		// the only guard of something else, is the entanglement worth naming.
		// Deliberately measured on the fold alone, not on fold-minus-route-cost:
		// the question "is this defence on loan from elsewhere" is about the
		// exchange, and mixing the mobilisation cost into it hid the
		// entanglement in the one fixture built to show it.
		const critical: { unit: Unit; foldWithout: number }[] = [];
		if (prize) {
			for (const u of d) {
				if (u.duty <= 0) continue;
				const lighter = pos.board.clone();
				lighter.take(parseSquare(u.from) as Square);
				const without = foldAt(lighter, target, attacker, {
					extraAttackers: a
						.filter((x) => x.arrival > 0)
						.map((x) => parseSquare(x.from) as Square),
					extraDefenders: d
						.filter((x) => x !== u && x.arrival > 0)
						.map((x) => parseSquare(x.from) as Square),
				});
				if (without.value > fold.value) {
					critical.push({ unit: u, foldWithout: without.value });
				}
			}
		}

		if (k === 0) {
			// Nobody gets a move: the attacker takes, or does not. The number is
			// the legal capture, not the fold — the fold is arithmetic on a
			// square and does not know whether the move can be played.
			const now = attacker === pos.turn ? captureOn(pos, target) : null;
			rows.push({
				k,
				attackers: a,
				defenders: d,
				fold,
				spent: 0,
				net: now?.gain ?? (attacker === pos.turn ? 0 : fold.value),
				critical,
			});
			continue;
		}

		// From here the defender has a move, and it can be ANY legal move — not
		// only "bring another defender", which is what the first version
		// assumed and is why it called a repairable pin winnable.
		let play: ContestRow['play'] | undefined;
		if (k === 1) {
			const start = pos.clone();
			start.turn = attacker;
			let bestPlay: ContestRow['play'] | undefined;

			for (const u of a) {
				if (u.arrival !== 1 || !u.via) continue;
				const from = parseSquare(u.from) as Square;
				const to = parseSquare(u.via) as Square;
				const after = start.clone();
				try {
					after.play({ from, to });
				} catch {
					// The route was found on a frozen board; the move may not be
					// legal in the real position. Skipping it is right, and it is
					// the reason arrival is a claim about geometry rather than
					// about play.
					continue;
				}

				const answers = replies(after);
				const defence = answers[0] ?? null;
				// Net, not gross: what the attacker keeps after the defender's
				// counter-blow, which is the number the whole plan turns on.
				const survives = defence ? defence.net : (bestCapture(after)?.gain ?? 0);

				if (!bestPlay || survives > bestPlay.survives) {
					bestPlay = { move: { from: u.from, to: u.via }, defence, survives };
				}
			}
			play = bestPlay;
		}

		rows.push({
			k,
			attackers: a,
			defenders: d,
			fold,
			spent,
			// k = 1 has a real answer; k >= 2 is a count of who could be there,
			// and is NOT a claim about what happens — two build-up moves means
			// two defensive replies, which this does not model.
			net: play ? play.survives - spent : fold.value - spent,
			critical,
			...(play ? { play } : {}),
		});
	}

	// The race is run from the real position, with the real side to move.
	const run =
		attacker === pos.turn
			? race(pos, target, attacker, maxTempi * 2)
			: { value: 0, line: [], plies: 0, truncated: false };

	// Winnable now means: the attacker has a move, and what they win survives the
	// defender's best answer. "The prize can leave" is no longer a column of its
	// own — leaving is one of the defender's legal replies, and so are breaking
	// the pin, blocking, and checking.
	let winnableAt: number | null = null;
	for (const row of rows) {
		if (row.k > 1) break; // k >= 2 is a count, not a claim. See ContestRow.
		if (row.net > 0) {
			winnableAt = row.k;
			break;
		}
	}

	return {
		target: targetSquare,
		prize,
		attacker,
		turn: pos.turn,
		rows,
		escapes,
		escapeCost,
		winnableAt,
		race: run,
		verdict: judge(rows, run, attacker === pos.turn),
		caveats: CAVEATS,
	};
}

/**
 * What the table amounts to — including the two answers that are not a number.
 *
 * The order matters. An unresolved escape outranks a winning fold, because a
 * prize that leaves into a counter-threat makes the fold irrelevant; and
 * entanglement outranks a losing fold, because "the defence holds" is false if
 * the defence is on loan from somewhere else.
 */
export function judge(
	rows: ContestRow[],
	run: RaceResult,
	attackerToMove: boolean,
): Contest['verdict'] {
	if (!attackerToMove) {
		return {
			kind: 'unresolved',
			why: 'It is not the attacking side to move, so there is no race to run. Flip the side to move to ask this question.',
		};
	}

	const tempi = Math.ceil(run.line.length / 2);
	const line = run.line.join(' ');

	if (run.value > 0) {
		return {
			kind: 'winnable',
			at: tempi,
			why:
				tempi === 0
					? `Take it now: ${run.value} after the exchange.`
					: `${run.value} after ${tempi} tempo${tempi === 1 ? '' : 's'} of build-up${line ? ` — ${line}` : ''}. Their best answers are in the race below.`,
		};
	}

	// Does the count say the exchange would pay while the race says it does not?
	// That gap is the lesson: the tempo buys nothing, and the reason is the
	// defender's move.
	const paying = rows.find((r) => r.fold.value - r.spent > 0);
	if (paying) {
		const answer = run.line[1] ?? paying.play?.defence
			? `${paying.play?.defence?.from}–${paying.play?.defence?.to}`
			: null;
		return {
			kind: 'not-winnable',
			why:
				`The exchange count says ${paying.fold.value - paying.spent} at k = ${paying.k}, but the race ends at ${run.value}` +
				(answer ? ` — they answer ${answer} and the tempo buys nothing.` : '.'),
		};
	}

	// The defence is on loan from somewhere else, even though nothing wins here.
	for (const row of rows) {
		const c = row.critical[0];
		if (!c) continue;
		const guaranteed = Math.min(c.foldWithout, c.unit.duty);
		return {
			kind: 'entangled',
			at: row.k,
			why:
				`Nothing is winnable here yet, but the defence at k = ${row.k} rests on the ${c.unit.role} on ${c.unit.from} — without it the exchange wins ${c.foldWithout}, ` +
				`and that piece is the only thing holding ${c.unit.dutyAt ?? 'another square'} (${c.unit.duty}). It cannot do both; they would concede the smaller of the two — ${guaranteed}.`,
		};
	}

	return {
		kind: 'not-winnable',
		why: `Nothing to win: the race over ${run.plies} plies ends at ${run.value}.`,
	};
}

/**
 * Shown next to every table. These are not hedges; each one is a specific
 * approximation with a direction of error, and a reader who does not know them
 * will over-trust a row. EXPLOITABILITY.md §7 has the full list.
 */
export const CAVEATS = [
	'Routes are found on a frozen board — nothing else moves while a piece travels.',
	'The defender is assumed to spend their tempi defending, so “winnable” is the sound direction and “not winnable” is only indicative.',
	'Route cost and fold value are added as if a tempo and a pawn were the same currency.',
	'Nested contests (removing a defender) are not resolved; the account stops rather than guesses.',
	'Only pieces are prizes. A contest for an empty square — a fork square, an outpost — is not modelled yet.',
];
