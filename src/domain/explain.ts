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
 * The severity ladder — a CONFIGURABLE learning signal, not a fixed opinion.
 *
 * Will: "I don't care about 'harshness' — I care about a consistent learning
 * signal, but this could easily just be configurable. Later we may want to make
 * it relative to user rating."
 *
 * So it is a parameter with a default rather than three constants. The app
 * already carries two such scales for two purposes — `session.ts` and `drill.ts`
 * use 60/120 to police a repertoire, `analyseGame.ts` uses 150/800 to review a
 * real game — and the point of taking one here would only ever have been to add
 * a third. `explain` takes whichever the caller is teaching against.
 *
 * A rating-relative ladder drops straight in: the same shape, with the numbers
 * widening as a player's own accuracy widens, so the signal stays consistent
 * against what they can actually perceive rather than against a fixed bar.
 *
 * `equal` is not a noise tolerance. Scores come from fixed-depth single-move
 * searches and carry no engine noise at all, so it is the substantive claim that
 * two moves this close are not different lessons.
 */
export type Severity = {
	/** At or under this, the move is as good as the best. */
	equal: number;
	/** Up to here it is an inaccuracy; past `mistake` it is a blunder. */
	inaccuracy: number;
	mistake: number;
};

export const DEFAULT_SEVERITY: Severity = { equal: 30, inaccuracy: 90, mistake: 200 };

/** At least this much material must move before the trace is allowed to explain. */
const MATERIAL_CP = 100;

/**
 * Why a move is worse — and, crucially, what we decline to say.
 *
 * Each variant is a claim that can be checked against something. There is no
 * `{ kind: 'positional', amount: n }`, and there must never be one.
 */
export type Because =
	/**
	 * The engine's line after this move ends in mate against the mover.
	 *
	 * `bestAlso` is set when the best move is ALSO mated, in however many moves —
	 * the position is lost either way, and saying "you walk into mate in 1" without
	 * that is a claim about the player's agency that the position does not support.
	 */
	| { kind: 'mateAgainst'; in: number; bestAlso?: number }
	/** A better move mates and this one does not mate at all. */
	| { kind: 'missedMate'; in: number }
	/**
	 * BOTH mate — this one just takes longer.
	 *
	 * Will: "if a mate in 1 marks a mate in 3 as error, the `because` can't say
	 * 'Nh6+ mates in 2, this does not' — that makes it seem like the alternative
	 * doesn't also mate."
	 *
	 * Quite. The first version had no case for it and fell through to the material
	 * or positional branch, which then described a won position as though a piece
	 * had gone missing. A slower mate is still a mate and the sentence has to say
	 * so.
	 */
	| { kind: 'slowerMate'; ours: number; best: number }
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
export function explain(
	fen: string,
	uci: string,
	options: Scored[],
	severity: Severity = DEFAULT_SEVERITY,
): Explanation {
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
		verdict: verdictOf(self, best, tr, severity),
	};
}

function verdictOf(
	self: Scored | undefined,
	best: Scored | undefined,
	tr: Trace,
	severity: Severity,
): Verdict {
	// No score means no verdict. An explainer that guesses when the engine
	// declined is exactly the failure mode this module is shaped against.
	if (!self || !best) return { kind: 'equal', loss: 0, comparable: false };

	const loss = self.loss; // zero or negative
	const behind = -loss;
	// A difference between a mate score and anything else is not a centipawn
	// quantity — see `comparable`.
	const comparable = self.mate === null && best.mate === null;

	if (self.uci === best.uci) return { kind: 'best', loss, comparable };

	// ------------------------------------------------------------------
	// MATE IS ITS OWN TAXONOMY, and the severity ladder does not apply to it.
	//
	// Falling through to `!comparable -> blunder` called a mate in three a blunder
	// because a mate in two existed. The game is won either way; that is an
	// inaccuracy at worst, and the sentence has to admit the move mates.
	// ------------------------------------------------------------------
	const ourMate = self.mate;
	const theirBest = best.mate;

	if (ourMate !== null && ourMate > 0) {
		// We mate. The only way to be behind is to mate more slowly.
		if (theirBest !== null && theirBest > 0 && ourMate > theirBest)
			return {
				kind: 'inaccuracy',
				loss,
				comparable,
				because: { kind: 'slowerMate', ours: ourMate, best: theirBest },
			};
		return { kind: 'equal', loss, comparable };
	}

	if (ourMate !== null && ourMate < 0) {
		// We get mated. Whether that is a blunder depends on whether it was
		// avoidable: if the best move is mated too, the position is already lost
		// and the move merely shortens it.
		const lost = theirBest !== null && theirBest < 0;
		return {
			kind: lost ? 'mistake' : 'blunder',
			loss,
			comparable,
			because: {
				kind: 'mateAgainst',
				in: Math.abs(ourMate),
				...(lost ? { bestAlso: Math.abs(theirBest as number) } : {}),
			},
		};
	}

	if (theirBest !== null && theirBest > 0)
		return { kind: 'blunder', loss, comparable, because: { kind: 'missedMate', in: theirBest } };

	// ------------------------------------------------------------------
	// Ordinary positions, where the ladder does apply.
	// ------------------------------------------------------------------
	if (behind <= severity.equal) return { kind: 'equal', loss, comparable };
	const kind =
		behind <= severity.inaccuracy ? 'inaccuracy' : behind <= severity.mistake ? 'mistake' : 'blunder';
	return { kind, loss, comparable, because: becauseOf(tr) };
}

/**
 * Why an ordinary move is worse. Mate never reaches here — `verdictOf` handles it
 * first, because a line that ends in mate is not usefully described as losing a
 * bishop.
 */
function becauseOf(tr: Trace): Because {
	// Material, and only when it actually moved. `tr.net` is the mover's own
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
