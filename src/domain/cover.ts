// Can they pay? — the covering condition, at one ply.
//
// ---------------------------------------------------------------------------
// DEFICIENCY.md §3. One move per tempo, so the question is not "how many things
// are attacked" but *is there a single move that answers all of it*:
//
//     deficiency  ⟺  ∄ m : E ⊆ Resolves(m)
//
// and when there isn't, `FORMALISM.md` §3.3's concession says what it costs:
//
//     L(E) = min over m of ( max over surviving e of SEE(π·m, S_e) )
//
// Two deliberate departures from the document, both toward the stricter
// reading.
//
// The concession is measured against the ledger RECOMPUTED after the move, not
// against the surviving members of the original E. §3.3 defines it the second
// way, which quietly permits a move that saves the rook by hanging the queen —
// the queen was not in E, so it does not count against the move that created
// it. Recomputing subsumes the original definition and closes that hole.
//
// The verdict is derived by replaying each move rather than by reading a delta
// off a contingency index (§7). That index is the right end state and is not
// built yet. At τ = 1 the replay is correct and the cost is bearable, and
// building the index before the condition it serves is verified would mean
// debugging two things at once.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { NormalMove, Role } from 'chessops/types';
import type { Board } from 'chessops/board';
import { SquareSet } from 'chessops/squareSet';
import { seeValue, V } from './exchange';
import { ledger, worst, type Obligation } from './ledger';

/** Every legal move, promotions expanded. */
export function legalMoves(pos: Chess): NormalMove[] {
	const out: NormalMove[] = [];
	const back = pos.turn === 'white' ? 7 : 0;
	for (const [from, dests] of pos.allDests()) {
		const piece = pos.board.get(from);
		for (const to of dests) {
			if (piece?.role === 'pawn' && to >> 3 === back) {
				for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as Role[]) {
					out.push({ from, to, promotion });
				}
			} else {
				out.push({ from, to });
			}
		}
	}
	return out;
}

/**
 * What a move lifts off the board, before any answer.
 *
 * The RAW value, not `seeValue`. Pricing the whole exchange here and then
 * modelling the opponent's reply separately counts the recapture twice — the
 * reply IS the recapture. Each ply is credited what it takes and charged what
 * the next ply takes back, which is the only arrangement that stays symmetric.
 */
export function taken(pos: Chess, m: NormalMove): number {
	const victim = pos.board.get(m.to);
	if (!victim || victim.color === pos.turn) return 0;
	return V[victim.role] + (m.promotion ? V[m.promotion] - V.pawn : 0);
}

const after = (pos: Chess, m: NormalMove): Chess | null => {
	const next = pos.clone();
	try {
		next.play(m);
	} catch {
		return null;
	}
	return next;
};

/** One candidate discharge, and what it leaves outstanding. */
export type Cover = {
	move: NormalMove;
	/** Obligations from `E` that no longer stand after this move. */
	resolves: Obligation[];
	/** The whole ledger afterwards — including debts this move created. */
	after: Obligation[];
	/** The largest surviving debt. This is what the move concedes. */
	concedes: number;
};

export type Mode =
	/** Every debt covered by one move. */
	| 'solvent'
	/** Something is unpayable. `classify` says which of the next two it is. */
	| 'deficient'
	/** Each debt is individually answerable; no single move answers them all. */
	| 'cardinality'
	/** Some debt has no answer even on its own. */
	| 'emptiness'
	/** No legal move. */
	| 'immobile';

export type Verdict = {
	/** What the side to move owes. */
	owed: Obligation[];
	/** The best defence available. */
	best: Cover | null;
	/** L(E). Zero when solvent. */
	concession: number;
	/** The debt that survives the best defence — the thing to name in a sentence. */
	survives: Obligation | null;
	mode: Mode;
};

/**
 * What the side to move can and cannot pay.
 *
 * `emptiness` is distinguished from `cardinality` because they are different
 * facts about the position and a human acts on them differently (§3): an empty
 * cover set means the piece is simply gone — stop looking — while an
 * oversubscribed one means look for the move that answers two.
 */
export function verdict(pos: Chess): Verdict {
	const E = ledger(pos, pos.turn);
	const moves = legalMoves(pos);

	if (!moves.length) {
		return { owed: E, best: null, concession: worst(E), survives: E[0] ?? null, mode: 'immobile' };
	}
	if (!E.length) {
		return { owed: E, best: null, concession: 0, survives: null, mode: 'solvent' };
	}

	/** Which debts each move answered, for the emptiness test below. */
	const answered = new Set<number>();
	let best: Cover | null = null;

	for (const move of moves) {
		const next = after(pos, move);
		if (!next) continue;
		// The ledger from OUR side of the board, read in the position we would be
		// leaving them. Recomputed rather than filtered — see the header.
		const rest = ledger(next, pos.turn);
		const live = new Set(rest.map((e) => e.square));
		const resolves = E.filter((e) => !live.has(e.square));
		for (const e of resolves) answered.add(e.square);
		// Their reply is scored by what it still owes MINUS what it collects.
		//
		// Scoring it by the debt alone was blind to a defence that is also a capture
		// — discharge type (6) in DEFICIENCY.md §2, listed and never implemented. On
		// Uqazm it valued Q×h7+ at a whole queen: the reply K×h7 takes the queen
		// straight back and nothing in the arithmetic noticed. This is Will's
		// standing point that the ledger must be symmetric, in the one place it was
		// not.
		const concedes = worst(rest) - taken(pos, move);
		if (!best || concedes < best.concedes) best = { move, resolves, after: rest, concedes };
	}

	if (!best) {
		return { owed: E, best: null, concession: worst(E), survives: E[0] ?? null, mode: 'immobile' };
	}

	// Coarse on purpose. Telling cardinality from emptiness needs the isolation
	// test in `classify`, which costs a pseudo-legal expansion per obligation —
	// far too much for a function `claims` calls once per legal move. The
	// distinction is for the annotation, so it is computed where it is read.
	const orphan = E.find((e) => !answered.has(e.square)) ?? null;

	return {
		owed: E,
		best,
		concession: best.concedes,
		survives: best.after[0] ?? orphan,
		mode: best.concedes <= 0 ? 'solvent' : 'deficient',
	};
}

/** A move of ours, scored by what it leaves them unable to pay. */
export type Claim = {
	move: NormalMove;
	/** What the move collects on the spot, as an exchange rather than a raw value. */
	takes: number;
	/** L(E) for the opponent afterwards — what it leaves them unable to pay. */
	deficiency: number;
	/** takes + deficiency. The number that ranks. */
	value: number;
	verdict: Verdict;
};

/**
 * The detector, at τ = 1.
 *
 * Play the move that leaves them owing the most they cannot pay. Not the most
 * coercive move and not the most material taken — those are both proxies for
 * this, and both of them have been wrong here before.
 *
 * Note there is no depth parameter, and nowhere to put one.
 */
export function claims(pos: Chess): Claim[] {
	const out: Claim[] = [];
	for (const move of legalMoves(pos)) {
		const next = after(pos, move);
		if (!next) continue;
		const v = verdict(next);
		// Collected material and unpayable debt are both winnings, and scoring only
		// the second was the first probe's finding: N×a2 winning a rook outright
		// scored ZERO, because taking the rook converts the obligation into material
		// and the ledger afterwards is empty. A capture discharges the debt by
		// collecting it. Both halves have to count.
		//
		// En passant is still missed: the prize is not on the destination square
		// (FORMALISM §1.1b).
		const takes = taken(pos, move);
		out.push({ move, takes, deficiency: v.concession, value: takes + v.concession, verdict: v });
	}
	return out.sort((a, b) => b.value - a.value);
}


// ---------------------------------------------------------------------------
// Cardinality or emptiness — the distinction, done properly.
//
// Will: "cardinality is most correct. The King is just a piece like any other
// but with infinite value."
//
// He is right, and the reason is sharper than a preference. A fork whose prong
// is check used to report as EMPTINESS, because `allDests` has already deleted
// every non-king move before the covering condition runs — so the forked rook
// appears to have no discharge at all. Check was being enforced twice: once by
// move legality, once by the infinite obligation. That double enforcement is
// exactly what `FORMALISM.md` §1.4 refuses — "the legality of check is a
// CONSEQUENCE of the value assignment rather than a rule bolted onto it" — and
// using the legal move set quietly bolted it back on.
//
// So the isolation test asks *could this debt be paid if it were the only one*,
// over moves that ignore the check requirement. Pins still bind, because a
// pinned piece genuinely cannot leave its ray whatever else is happening.
// Nothing is made unsound by dropping the check rule: a move exposing the king
// produces an infinite obligation and is rejected by value.
//
// The taxonomy still separates what matters. Mate is the infinite obligation
// with an empty cover in isolation, so it stays emptiness. A trapped piece
// stays emptiness. Stalemate is immobile. What changes is that a fork now reads
// as a fork.
// ---------------------------------------------------------------------------

/** Moves ignoring only the requirement to answer check. Pins still bind. */
export function unchecked(pos: Chess): NormalMove[] {
	const ctx = pos.ctx();
	const free = { ...ctx, checkers: SquareSet.empty() };
	const out: NormalMove[] = [];
	const back = pos.turn === 'white' ? 7 : 0;
	for (const from of pos.board[pos.turn]) {
		const piece = pos.board.get(from);
		let dests: SquareSet;
		try {
			dests = pos.dests(from, free);
		} catch {
			continue;
		}
		for (const to of dests) {
			if (piece?.role === 'pawn' && to >> 3 === back) {
				for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as Role[]) {
					out.push({ from, to, promotion });
				}
			} else {
				out.push({ from, to });
			}
		}
	}
	return out;
}

/** The board after a move, with no legality checked. For the isolation test only. */
function shifted(pos: Chess, m: NormalMove): Board {
	const b = pos.board.clone();
	const piece = b.take(m.from);
	if (!piece) return b;
	b.take(m.to);
	b.set(m.to, m.promotion ? { color: piece.color, role: m.promotion } : piece);
	return b;
}

/** Which kind of failure this is. Slow; for the sentence, not for the ranking. */
export function classify(pos: Chess): Mode {
	const v = verdict(pos);
	if (v.mode !== 'deficient') return v.mode;
	const pseudo = unchecked(pos);
	const payableAlone = (e: Obligation) =>
		pseudo.some((m) => seeValue(shifted(pos, m), e.square, e.claimant) <= 0);
	return v.owed.every(payableAlone) ? 'cardinality' : 'emptiness';
}
