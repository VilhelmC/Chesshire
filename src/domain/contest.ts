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

import { attacks } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Square, Color, Role, Piece } from 'chessops/types';
import type { Board } from 'chessops/board';
import { positionFromFen, makeSquare, parseSquare } from './chess';
import type { Chess } from 'chessops/chess';

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
	/** cost + exposes. Zero or less means a free escape. */
	total: number;
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
};

export type Contest = {
	target: string;
	/** What stands on the target square, if anything. */
	prize: { role: Role; colour: Color; value: number } | null;
	/** The side trying to win the prize. */
	attacker: Color;
	rows: ContestRow[];
	/** Where the prize can go, and what going there costs it. */
	escapes: Escape[];
	/** The cheapest escape's total cost. Null when there is no escape at all. */
	escapeCost: number | null;
	/** Smallest k whose net is positive AND from which the prize cannot walk. */
	winnableAt: number | null;
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
		const candidates = [...new Set([...inContact, ...joined])].filter((s) => s !== target);
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

		seq.push({ colour: side, from: best, role: piece.role, captured: onSquare });

		// The capturer now stands on the square and is itself the next prize.
		onSquare = VALUE[piece.role];
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
			out.push({
				from: sq(from),
				role: piece.role,
				colour,
				value: VALUE[piece.role],
				arrival: 0,
				routeCost: 0,
				available: canMove(pos, from),
				...(canMove(pos, from) ? {} : { note: 'pinned — cannot move' }),
			});
			continue;
		}

		const found = search(board, from, piece, target, maxTempi);
		if (found) {
			out.push({
				from: sq(from),
				role: piece.role,
				colour,
				value: VALUE[piece.role],
				arrival: found.tempi,
				via: sq(found.via),
				routeCost: found.cost,
				available: canMove(pos, from),
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
		const after = pos.board.clone();
		after.take(target);
		const taken = after.get(to);
		if (taken) after.take(to);
		after.set(to, piece);

		const landing = foldAt(after, to, other(piece.color));
		const cost = Math.max(0, landing.value) - (taken ? VALUE[taken.role] : 0);

		// What leaving exposed: the opponent's best fold anywhere on our side,
		// which is the relative-pin term without needing a separate concept.
		let exposes = 0;
		for (const s of after[piece.color]) {
			if (s === to) continue;
			const f = foldAt(after, s, other(piece.color));
			if (f.value > exposes) exposes = f.value;
		}

		out.push({ to: sq(to), cost, exposes, total: cost + exposes });
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
		rows.push({ k, attackers: a, defenders: d, fold, spent, net: fold.value - spent });
	}

	// Winnable means the fold pays AND the prize could not have walked away in
	// the time the build-up took. A pin is what puts a zero in that column.
	let winnableAt: number | null = null;
	for (const row of rows) {
		const canRun = escapeCost !== null && escapeCost <= 0 && row.k > 0;
		if (row.net > 0 && !canRun) {
			winnableAt = row.k;
			break;
		}
	}

	return {
		target: targetSquare,
		prize,
		attacker,
		rows,
		escapes,
		escapeCost,
		winnableAt,
		caveats: CAVEATS,
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
