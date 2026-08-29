// One explanation: what a move is worth, and what happens if you play it.
//
// ---------------------------------------------------------------------------
// PURE. No React, no engine calls of its own — it is handed a scored option set
// and assembles the rest from the board. That is what makes it testable, and it
// is also what keeps the recursion cheap: a child explanation is the same
// assembly over a different position, and nothing here holds state.
//
// ---------------------------------------------------------------------------
// THE RULE THIS MODULE EXISTS TO ENFORCE: TRUE OR SILENT.
//
// `PLAN-EXPLAINER.md` §9.1 — the explainer has no ground truth, so it cannot be
// scored the way the solver was. The mitigation is structural rather than
// measured: it may only ever state things that are independently true — an engine
// score, a material count off a board, a primitive that passed its own gate — and
// must be silent otherwise.
//
// The temptation this is guarding against is specific. When material does not
// explain the drop, the obvious move is to report `engineScore − materialDelta`
// as "the positional part". That number is not a positional evaluation: NNUE has
// no material term to subtract, its piece values are position-dependent, and the
// remainder is the engine's disagreement with our piece values plus the horizon
// gap. So `Because` is a discriminated union in which the positional case carries
// **no number at all**. The type makes the honest thing the only expressible one.
// ---------------------------------------------------------------------------

import type { Role } from 'chessops/types';
import type { Scored } from '../engine/compare';
import { lineFromUci, type Line } from './line';
import { trace, type Trace } from './trace';

/**
 * The severity ladder.
 *
 * The app already carries two of these for two purposes — `session.ts` and
 * `drill.ts` use 60/120 to police a repertoire, `analyseGame.ts` uses 150/800 to
 * review a real game — and they disagree because a drill should be stricter than
 * a post-mortem. An explainer is asked about arbitrary moves in either context,
 * so it takes the wider, review-shaped reading: calling a 70cp inaccuracy a
 * "mistake" to a person who just played it is a harsher word than the position
 * deserves.
 *
 * EQUAL is deliberately generous. Scores here come from fixed-depth single-move
 * searches and carry no engine noise at all, so this is not a tolerance for
 * measurement error — it is the claim that two moves within a third of a pawn are
 * not meaningfully different to the person being taught.
 */
export const EQUAL_CP = 30;
export const INACCURACY_CP = 90;
export const MISTAKE_CP = 200;

/** At least this much material must move before the trace is allowed to explain. */
const MATERIAL_CP = 100;

/**
 * Why a move is worse — and, crucially, what we decline to say.
 *
 * Each variant is a claim that can be checked against something. There is no
 * `{ kind: 'positional', amount: n }`, and there must never be one.
 */
export type Because =
	/** The engine's line after this move ends in mate against the mover. */
	| { kind: 'mateAgainst'; in: number }
	/** A better move mates and this one does not. */
	| { kind: 'missedMate'; in: number }
	/**
	 * In the engine's line, material goes the wrong way.
	 *
	 * `net` is the whole line's swing; `ply` and `piece` name the single worst
	 * moment in it, which is what a sentence wants. This is a claim about THE LINE
	 * — "in this line the bishop goes" — not a claim that the material accounts
	 * for the evaluation. The two are different, and only the first is checkable.
	 */
	| {
			kind: 'material';
			net: number;
			ply: number;
			piece: Role | null;
			/**
			 * WHAT HAPPENED, because the piece alone does not say it.
			 *
			 * The first version reported only the role and the panel rendered "the
			 * queen goes". On `MU1Mv` the worst ply was `d1=Q` — the OPPONENT
			 * promoting — so the number was right and the sentence was false: no
			 * queen went anywhere, one arrived on the other side. A negative delta is
			 * always the opponent's move, and they either took one of ours or made a
			 * new one of their own. Those are different sentences.
			 */
			event: 'captured' | 'promoted';
	  }
	/**
	 * Material is level and the engine still prefers something else.
	 *
	 * Carries no number, by construction. The honest sentence is "material is
	 * level; the difference is positional", and then a named primitive takes over
	 * or nothing does.
	 */
	| { kind: 'positional' };

export type Verdict = {
	kind: 'best' | 'equal' | 'inaccuracy' | 'mistake' | 'blunder';
	/** Centipawns behind the best move in the set. Zero or above for the best. */
	loss: number;
	/**
	 * Is `loss` a MEANINGFUL centipawn quantity?
	 *
	 * False when either side of the comparison is a mate. Mate is folded into the
	 * ±10000 band so that a mate in one outranks a mate in three on a single
	 * number — which is right for ORDERING and meaningless as a difference. The
	 * gate caught the panel rendering "−110.92 against Nh6+" for a move that
	 * simply fails to mate; the honest line there is "Nh6+ mates in 2, this does
	 * not", and `because` already says exactly that.
	 *
	 * The number is still correct for sorting. It is just not a number to show.
	 */
	comparable: boolean;
	/** Absent when the move is best or equal — there is nothing to explain. */
	because?: Because;
};

export type Explanation = {
	fen: string;
	/** The move being explained. */
	uci: string;
	san: string;
	/** Every candidate, best first, all on one scale. */
	options: Scored[];
	/** This move's row. Absent when the engine would not score it. */
	self?: Scored;
	/** The best available. */
	best?: Scored;
	/** The engine's line after this move — steppable, and its tail is not evidence. */
	line: Line;
	/** Material and forcing along that line. */
	trace: Trace;
	verdict: Verdict;
};

/**
 * Assemble an explanation from an already-scored option set.
 *
 * `options` must come from one `scoreMoves` call, so every score is on one scale
 * — see `engine/compare.ts` for why that is not automatic.
 */
export function explain(fen: string, uci: string, options: Scored[]): Explanation {
	const self = options.find((o) => o.uci === uci);
	const best = options[0];

	// The line is the engine's own PV for this move, which begins with the move.
	// `lineFromUci` stops at the first illegal move and says so, which is the right
	// behaviour for a PV that has been truncated by a transposition-table hit.
	const line = lineFromUci(fen, self?.pv?.length ? self.pv : [uci]);
	const mover = fen.split(' ')[1] === 'b' ? 'b' : 'w';
	const tr = trace(line, mover);

	return {
		fen,
		uci,
		san: self?.san ?? line.steps[0]?.san ?? uci,
		options,
		self,
		best,
		line,
		trace: tr,
		verdict: verdictOf(self, best, tr),
	};
}

function verdictOf(self: Scored | undefined, best: Scored | undefined, tr: Trace): Verdict {
	// No score means no verdict. An explainer that guesses when the engine
	// declined is exactly the failure mode this module is shaped against.
	if (!self || !best) return { kind: 'equal', loss: 0, comparable: false };

	const loss = self.loss; // zero or negative
	const behind = -loss;
	// A difference between a mate score and anything else is not a centipawn
	// quantity — see `comparable`.
	const comparable = self.mate === null && best.mate === null;

	if (self.uci === best.uci) return { kind: 'best', loss, comparable };
	if (comparable && behind <= EQUAL_CP) return { kind: 'equal', loss, comparable };

	const kind = !comparable
		? 'blunder'
		: behind <= INACCURACY_CP
			? 'inaccuracy'
			: behind <= MISTAKE_CP
				? 'mistake'
				: 'blunder';
	return { kind, loss, comparable, because: becauseOf(self, best, tr) };
}

function becauseOf(self: Scored, best: Scored, tr: Trace): Because {
	// Mate first, in both directions, because it outranks any material story: a
	// line that ends in mate is not usefully described as losing a bishop.
	if (self.mate !== null && self.mate < 0) return { kind: 'mateAgainst', in: Math.abs(self.mate) };
	if (best.mate !== null && best.mate > 0 && (self.mate === null || self.mate <= 0))
		return { kind: 'missedMate', in: best.mate };

	// Then material, and only when it actually moved. `tr.net` is the mover's own
	// side, so negative is material lost.
	if (tr.net <= -MATERIAL_CP) {
		// The single worst moment, which is what a sentence wants — "the bishop goes
		// on move 3" rather than "you end up 330 down".
		let worst = tr.steps[0];
		for (const s of tr.steps) if (!worst || s.delta < worst.delta) worst = s;
		// A negative delta is always the opponent's move, so either they took one of
		// ours or they promoted. `captured` wins when both are true — a capture that
		// also promotes is more naturally read as the capture.
		const event = worst?.captured ? 'captured' : 'promoted';
		return {
			kind: 'material',
			net: tr.net,
			ply: worst?.ply ?? 0,
			piece: worst?.captured ?? worst?.promoted ?? null,
			event,
		};
	}

	// Material is level and the engine still prefers something else. Say that, and
	// nothing more — see the header.
	return { kind: 'positional' };
}

/**
 * The moves worth offering beside this one.
 *
 * A comparison set with thirty entries is a move list, not an explanation. The
 * best, the move asked about, and enough of the rest to show the shape of the
 * choice — which is the same argument `candidateMoves` makes for the options
 * overlay.
 */
export function shortlist(options: Scored[], uci: string, limit = 4): Scored[] {
	const head = options.slice(0, limit);
	if (head.some((o) => o.uci === uci)) return head;
	const self = options.find((o) => o.uci === uci);
	// The move asked about is always present, even when it is thirtieth — its
	// absence is the one thing the reader would certainly notice.
	return self ? [...head.slice(0, limit - 1), self] : head;
}
