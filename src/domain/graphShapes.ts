// The graph, as something you can look at.
//
// ---------------------------------------------------------------------------
// PLAN.md M1f, and the overlay section.
//
// This is not decoration. Two of this project's worst errors were assertions
// written from the armchair about structures nobody had inspected — a race term
// that measured distance on the wrong board, and a whole module that claimed to
// be a ledger while being a search. A graph you can SEE is a graph whose wrong
// edge is obvious, instead of one inferred from a wrong number four layers
// downstream.
//
// It is also the pedagogy the detector exists for. "Your knight guards f7 and
// d6" is a picture before it is a sentence, and the picture is the same object
// the algorithm reasons over — not an illustration of it.
//
// Kept as a pure function from `Graph` to shapes so it can be tested without a
// browser, which is the only reason the layers below have any assertions at all.
// ---------------------------------------------------------------------------

import { makeSquare } from 'chessops/util';
import { between, ray } from 'chessops/attacks';
import type { Board } from 'chessops/board';
import type { Color, Square } from 'chessops/types';
import { V, other } from './exchange';
import { on, sensitive, isLive, blockedBy, type Graph } from './graph';
import { reach, critical } from './reach';
import { isLive as owedNow, type Obligation } from './ledger2';
import { cover as coverOf, concede as concedeOf, classify2, due, type Gamma } from './cover2';
import { couplings, chains, weight as coupleWeight, say as sayCouple, type Coupling } from './couple';

/** What the Board component draws. `dest` absent means a circle on `orig`. */
export type Shape = { orig: string; dest?: string; brush: string; label?: string };

export type Layer =
	/** Nothing. */
	| 'off'
	/** Live edges — who bears on what, right now. */
	| 'attacks'
	/** Latent edges — the x-ray, the battery, the discovered attack. */
	| 'latent'
	/** Squares whose occupancy changes at least one edge. */
	| 'sensitive'
	/** Exchanges, undefended pieces, pins — what the graph already knows. */
	| 'motifs'
	/** How far the focused piece is from everywhere, and which squares gate it. */
	| 'reach'
	/** What each side owes — the ledger's rows, with their weight and deadline. */
	| 'owed'
	/** Γ: every obligation joined to the moves that discharge it. */
	| 'cover'
	/** Couplings — the pieces doing two jobs, and the chains that move together. */
	| 'couplings'
	/** All three at once. Busy, and occasionally the only way to see the shape. */
	| 'all';

export const LAYERS: { key: Layer; label: string }[] = [
	{ key: 'off', label: 'no overlay' },
	{ key: 'attacks', label: 'attacks — live edges' },
	{ key: 'latent', label: 'latent — x-rays and batteries' },
	{ key: 'sensitive', label: 'sensitive squares' },
	{ key: 'motifs', label: 'motifs — exchanges and pins' },
	{ key: 'reach', label: 'reach — distance from the focused piece' },
	{ key: 'owed', label: 'owed — obligations, weight and deadline' },
	{ key: 'cover', label: 'Γ — obligations and what discharges them' },
	{ key: 'couplings', label: 'couplings — what is doing two jobs' },
	{ key: 'all', label: 'everything' },
];

/**
 * Brush per layer and colour.
 *
 * White and Black get different hues rather than different shades, because the
 * question being asked of this picture is almost always "whose?" — and a board
 * covered in one colour at two opacities answers it slowly.
 */
const BRUSH: Record<'live' | 'latent', Record<Color, string>> = {
	live: { white: 'gWhite', black: 'gBlack' },
	latent: { white: 'gWhiteX', black: 'gBlackX' },
};

/**
 * One piece's edges, or the whole board's.
 *
 * Focusing on a square is the difference between a diagram and a hairball: a
 * full middlegame has several hundred edges and drawing them all says only that
 * chess is complicated. With a focus it says what that piece is doing.
 */
/**
 * What the graph already knows, without inferring anything.
 *
 * PLAN-OVERLAY.md. Every row here is a structural fact about edges — not a
 * verdict about material, which needs SEE and belongs to the ledger. The
 * wording matters for the same reason: "undefended" is exactly true, where
 * "hanging" would be a claim about an exchange this layer has not computed.
 *
 * Pins are not a motif detector. Checkpoint M1 Finding 1: a pin IS a latent edge
 * whose blocker is an enemy piece and whose far square holds the enemy king (or
 * something dearer than the blocker). Drawing them implements that finding —
 * and makes `pinsFor` in exchange.ts a second implementation of one fact, which
 * M4 should delete.
 */
export type Motif =
	| { kind: 'exchange'; square: Square }
	| { kind: 'undefended'; square: Square; by: Color }
	| { kind: 'pin'; blocker: Square; from: Square; to: Square; absolute: boolean }
	| { kind: 'potentialPin'; blocker: Square; to: Square };

export function motifsIn(g: Graph, board: Board): Motif[] {
	const out: Motif[] = [];

	for (const square of board.occupied) {
		const w = on(g, square, 'white').length;
		const b = on(g, square, 'black').length;
		if (w && b) out.push({ kind: 'exchange', square });
		else {
			const piece = board.get(square);
			if (!piece) continue;
			// Only the enemy bears on it. A graph fact, not a verdict: whether it is
			// actually lost is an exchange, and the ledger owns that.
			const enemy = piece.color === 'white' ? b : w;
			const own = piece.color === 'white' ? w : b;
			if (enemy && !own) out.push({ kind: 'undefended', square, by: other(piece.color) });
		}
	}

	for (const e of g.edges) {
		if (e.cost !== 1 || isLive(e, board)) continue;
		// A pin needs exactly ONE thing in the way. Two blockers is a queue, not a
		// pin: removing either leaves the other, so nothing is shielded.
		const inTheWay = blockedBy(e, board);
		if (inTheWay.length !== 1) continue;
		const shield = inTheWay[0];
		const blocker = board.get(shield);
		const behind = board.get(e.to);
		if (!blocker || !behind) continue;
		// Both the shielded piece and the shield must belong to the other side —
		// a piece standing in front of its OWN king is a battery, not a pin.
		if (blocker.color === e.colour || behind.color === e.colour) continue;
		if (behind.role === 'king') out.push({ kind: 'pin', blocker: shield, from: e.from, to: e.to, absolute: true });
		else if (V[behind.role] > V[blocker.role])
			out.push({ kind: 'pin', blocker: shield, from: e.from, to: e.to, absolute: false });
	}

	// Alignments nobody is exploiting yet: two enemy pieces on one ray with
	// nothing between and the far one worth more. Whether it can be exploited is
	// a distance question and therefore M2's — this only says the shape is there.
	const pinned = new Set(out.filter((m) => m.kind === 'pin').map((m) => (m as { blocker: Square }).blocker));
	for (const colour of ['white', 'black'] as Color[]) {
		const mine = [...board[colour]];
		for (const a of mine) {
			if (pinned.has(a)) continue;
			const near = board.get(a);
			if (!near) continue;
			for (const b of mine) {
				if (a === b) continue;
				const far = board.get(b);
				if (!far) continue;
				if (far.role !== 'king' && V[far.role] <= V[near.role]) continue;
				if (ray(a, b).isEmpty()) continue;
				if (!between(a, b).intersect(board.occupied).isEmpty()) continue;
				out.push({ kind: 'potentialPin', blocker: a, to: b });
				break;
			}
		}
	}

	return out;
}

/**
 * How an obligation reads on a square: pawns, and the deadline.
 *
 * Terse because it is drawn INSIDE a square next to a piece. `8/3` is a queen's
 * worth of promotion three tempi out. Check is `#` rather than a number, since
 * `V[king] = Infinity` has no reading in pawns and printing `Infinity` in a
 * 40-pixel box says only that something went wrong.
 */
export const badge = (o: Obligation): string =>
	Number.isFinite(o.weight) ? `${Math.round(o.weight / 100)}/${o.deadline}` : '#';

/**
 * Brush per discharge type — AMEND-2-ARRIVES §1's table, as four hues.
 *
 * Hue says which KIND, per this file's existing argument, and the `X` variant
 * says the discharge needs more than one tempo. That is the same live/latent
 * convention the attack layers use, which matters: a cost-3 cover is exactly as
 * real and exactly as not-yet-acting as a blocked x-ray.
 */
const COVER: Record<string, [string, string]> = {
	evade: ['gCovEvade', 'gCovEvadeX'],
	capture: ['gCovCapture', 'gCovCaptureX'],
	block: ['gCovBlock', 'gCovBlockX'],
	defend: ['gCovDefend', 'gCovDefendX'],
};

export function shapesFor(g: Graph, layer: Layer, focus?: number | null, board?: Board, gam?: Gamma): Shape[] {
	if (layer === 'off') return [];
	const out: Shape[] = [];
	const wanted = (e: { from: number }) => focus === undefined || focus === null || e.from === focus;

	if ((layer === 'attacks' || layer === 'all') && board) {
		for (const e of g.edges) {
			if (!isLive(e, board) || !wanted(e)) continue;
			out.push({ orig: makeSquare(e.from), dest: makeSquare(e.to), brush: BRUSH.live[e.colour] });
		}
	}

	if ((layer === 'latent' || layer === 'all') && board) {
		for (const e of g.edges) {
			if (isLive(e, board) || !wanted(e)) continue;
			out.push({ orig: makeSquare(e.from), dest: makeSquare(e.to), brush: BRUSH.latent[e.colour] });
		}
	}

	if (layer === 'sensitive' || layer === 'all') {
		// Circles, not arrows: a sensitive square is a property OF the square, and
		// drawing it as an arrow from somewhere would invent a direction the fact
		// does not have.
		for (const s of sensitive(g)) {
			if (focus !== undefined && focus !== null) {
				const touches =
					(g.appearsIfEmpty.get(s) ?? []).some((e) => e.from === focus) ||
					(g.diesIfFilled.get(s) ?? []).some((e) => e.from === focus);
				if (!touches) continue;
			}
			out.push({ orig: makeSquare(s), brush: 'gSense' });
		}
	}

	// Distance from ONE piece, so this layer needs a focus and says so when it
	// has none. A distance map for every piece at once would be sixteen
	// overlapping heat maps and no information at all.
	if (layer === 'reach' && board) {
		if (focus === undefined || focus === null) return out;
		const r = reach(board, focus, { limit: 4 });
		for (const [to, d] of r.dist) {
			if (d === 0) continue;
			out.push({ orig: makeSquare(to), brush: `gD${Math.min(d, 4)}`, label: String(d) });
		}
		// The squares that actually gate the journey — on EVERY minimal route, so
		// blocking one lengthens it and blocking anything else does not. Drawn to
		// the furthest reachable square, since that is the journey worth gating.
		let furthest: Square | null = null;
		let best = 0;
		for (const [to, d] of r.dist) if (d > best) ((best = d), (furthest = to));
		if (furthest !== null) {
			for (const s of critical(r, furthest)) out.push({ orig: makeSquare(s), brush: 'gGate' });
			out.push({ orig: makeSquare(focus), dest: makeSquare(furthest), brush: 'gGate' });
		}
	}

	// M3f. The ledger's rows, on the squares they are about. A latent row is drawn
	// faintly rather than omitted: "a pawn that queens once the knight leaves" is
	// a thing to watch, and hiding it is what made races invisible in the first
	// place.
	if ((layer === 'owed' || layer === 'cover') && board && gam) {
		for (const o of gam.E) {
			out.push({ orig: makeSquare(o.square), brush: owedNow(o, board) ? 'gOwed' : 'gOwedX', label: badge(o) });
		}
	}

	// M4. Γ itself: every obligation joined to what discharges it.
	//
	// Drawn from the discharging piece TO the required square, which is the
	// direction the move goes — not from the obligation outward. The picture is
	// then the move you would play, and the pedagogy is the same object the
	// algorithm reasons over rather than an illustration of it.
	if (layer === 'cover' && board && gam) {
		for (const e of gam.edges) {
			const o = gam.E[e.obligation];
			if (focus !== undefined && focus !== null && e.piece !== focus && o.square !== focus) continue;
			const pair = COVER[e.kind];
			if (!pair) continue;
			out.push({ orig: makeSquare(e.piece), dest: makeSquare(e.to), brush: pair[e.cost === 1 ? 0 : 1] });
		}
		// A row with no discharge in time is the whole point of the layer, and an
		// absence cannot be drawn as an arrow. Ringed instead.
		gam.coverable.forEach((ok, i) => {
			if (!ok) out.push({ orig: makeSquare(gam.E[i].square), brush: 'gUncovered' });
		});
	}

	// M5. §6.6: a tree over couplings annotates and a tree over plies does not.
	//
	//   "Your knight cannot guard f7 and d6 at once. If it takes on f7 you lose
	//    d6; if it holds, the exchange on f7 wins the rook."
	//
	// That is a sentence about a coupling, and the branch structure IS the
	// explanation — so the picture is the branch structure, not an illustration
	// of a line.
	if (layer === 'couplings' && board) {
		for (const c of couplings(board)) {
			if (c.kind === 'commitment') {
				// The piece that cannot be in two places, linked to both duties. Drawn
				// FROM the overloaded piece so the fan-out is visible as a fan-out:
				// one origin, several obligations, which is the shape of the problem.
				if (focus !== undefined && focus !== null && c.piece !== focus && !c.holds.includes(c.piece)) continue;
				out.push({ orig: makeSquare(c.piece), brush: 'gTwoJobs', label: String(Math.round(c.cost / 100)) });
				for (const h of c.holds) out.push({ orig: makeSquare(c.piece), dest: makeSquare(h), brush: 'gTwoJobs' });
			} else {
				if (focus !== undefined && focus !== null && c.from !== focus && c.to !== focus) continue;
				// Resolving one chain moves another. Direction is cause to effect.
				out.push({ orig: makeSquare(c.from), dest: makeSquare(c.to), brush: c.becomes > c.was ? 'gOpens' : 'gCloses' });
			}
		}
		// Every chain, faintly, so a coupling is visibly a relation BETWEEN two of
		// them rather than a fact about two arbitrary squares.
		for (const ch of chains(board)) out.push({ orig: makeSquare(ch.square), brush: 'gChain' });
	}

	if (layer === 'motifs' && board) {
		for (const m of motifsIn(g, board)) {
			if (m.kind === 'exchange') out.push({ orig: makeSquare(m.square), brush: 'gExchange' });
			else if (m.kind === 'undefended') out.push({ orig: makeSquare(m.square), brush: 'gLoose' });
			else if (m.kind === 'pin') {
				if (focus !== undefined && focus !== null && m.from !== focus && m.blocker !== focus) continue;
				out.push({ orig: makeSquare(m.blocker), brush: m.absolute ? 'gPin' : 'gPinSoft' });
				out.push({ orig: makeSquare(m.from), dest: makeSquare(m.to), brush: 'gPin' });
			} else {
				// Alignments are everywhere — a rook beside its castled king is one —
				// so these only draw when that piece is the focus. Shown unfiltered
				// they would paint most positions and mean nothing.
				if (focus === undefined || focus === null || m.blocker !== focus) continue;
				out.push({ orig: makeSquare(m.blocker), brush: 'gPinFaint' });
			}
		}
	}

	return out;
}

/** A one-line reading of what the focused piece is doing, for beside the board. */
export function describe(g: Graph, focus: number | null, board: Board): string | null {
	if (focus === null) return null;
	// Liveness is a question about the board now, not a field — so this needs one.
	// Without it every edge read as latent and the sentence said "bears on 0
	// squares", which is the sort of quiet wrongness a unified type invites if
	// the call sites are not swept.
	const live = g.edges.filter((e) => e.from === focus && isLive(e, board));
	const dark = g.edges.filter((e) => e.from === focus && !isLive(e, board));
	if (!live.length && !dark.length) return null;
	const bits = [`bears on ${live.length} square${live.length === 1 ? '' : 's'}`];
	if (dark.length) {
		// Sorted, so the sentence is the same sentence every time. Edge order is an
		// artefact of the ray walk and reads as randomness to anyone comparing two
		// positions.
		const blockers = [...new Set(dark.flatMap((e) => blockedBy(e, board)))]
			.map((b) => makeSquare(b))
			.sort();
		bits.push(`and on ${dark.length} more through ${blockers.join(', ')}`);
	}
	return bits.join(' ');
}


/**
 * What Γ says, in a sentence — DEFICIENCY.md §4's argmin and the `e` it leaves.
 *
 * *"This is your best move, and this is what it still costs you."* The pair is
 * the annotation, and it is available here because the computation held the
 * nouns rather than returning a number.
 */
export function explainCover(
	gam: Gamma,
	mode: ReturnType<typeof classify2>,
	best: ReturnType<typeof concedeOf>,
	/**
	 * How to write a move. Injected rather than imported.
	 *
	 * `DETECTOR.md` §6 says move rendering is figurine throughout, and it is —
	 * but `figurine()` lives in the view and needs a `Chess`, so a domain module
	 * reaching for it would have the dependency backwards. The caller supplies
	 * the house style; the default is squares, which is what the tests read.
	 */
	say: (from: Square, to: Square) => string = (f, t) => `${makeSquare(f)}${makeSquare(t)}`,
): string | null {
	if (!gam.E.length) return 'nothing owed';
	const now = due(gam).length;
	const owedText = `${gam.E.length} obligation${gam.E.length === 1 ? '' : 's'}, ${now} due now`;

	if (mode === 'covered') {
		const m = coverOf(gam).move;
		// A cover exists, or nothing is due and the deferred rows all have answers
		// in time. Both are "covered"; only the first names a move.
		return m ? `${owedText} — ${say(m.from, m.to)} answers everything due` : `${owedText} — all answerable in time`;
	}

	const cost = best.worst
		? `${Number.isFinite(best.loss) ? best.loss : 'the king'} on ${makeSquare(best.worst.square)}`
		: 'nothing nameable';

	if (mode === 'cardinality') {
		// The one mode a max over obligations cannot express, and the one the
		// pedagogy is about: look hardest for the move that answers two.
		const m = best.move;
		return `${owedText} — no move answers all of them${m ? `; best is ${say(m.from, m.to)}` : ''}, still costs ${cost}`;
	}
	if (mode === 'latency') {
		const late = gam.E.filter((_, i) => !gam.coverable[i]);
		const which = late.map((o) => makeSquare(o.square)).join(', ');
		return `${owedText} — the answer to ${which} exists but arrives late`;
	}
	const bare = gam.E.filter((_, i) => !gam.coverable[i]).map((o) => makeSquare(o.square)).join(', ');
	return `${owedText} — nothing at all discharges ${bare}`;
}


/**
 * What the couplings say, in §6.6's terms.
 *
 * Ranked by what ignoring one costs, because that is the order a human should
 * read them in — and because a position with six couplings and one that matters
 * is the common case, not the exception.
 */
export function explainCouplings(board: Board, limit = 2): string | null {
	const cs = couplings(board).sort((a, b) => coupleWeight(b) - coupleWeight(a));
	if (!cs.length) {
		// Not "nothing is happening". The chains ADD — which is §6.1's claim and
		// the reason there is no tree here, and saying so is more useful than
		// silence.
		const n = chains(board).length;
		return n > 1 ? `${n} exchanges, none coupled — the values simply add` : null;
	}
	return cs.slice(0, limit).map((c) => sayCouple(c, board)).join('; ');
}

/** The couplings a square takes part in, for the panel beside the board. */
export const couplingsAt = (board: Board, square: Square): Coupling[] =>
	couplings(board).filter((c) =>
		c.kind === 'commitment' ? c.piece === square || c.holds.includes(square) : c.from === square || c.to === square,
	);
