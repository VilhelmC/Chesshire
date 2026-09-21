// What a move leaves behind: a progress row, and sometimes a card.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT IN THE VIEW ANY MORE.
//
// Will, on free play: "worth considering if free play is its own tab … that
// would be the same tab we use to play games against bot, perhaps explore …
// and play against friends online?"
//
// Answering that needs to know how much of the trainer is actually about
// TRAINING. `RunState.mode` split "is this a drill" from "where in the drill";
// this is the other half of the same question, applied to the ~100 lines of
// `onMove` that decide what gets written down. They were the densest part of
// the view and the part least about rendering anything.
//
// Two branches, and the shape of them is the finding:
//
//   FREE PLAY logs every measurable move, unconditionally, and mines a card
//   from a bad one. It needs no expected set, no book and no notion of a
//   "current item" — which is exactly why a screen that only plays games
//   could call this and nothing else.
//
//   THE DRILL logs ONE row per encounter, keyed on an item, with a novelty
//   exemption and a first-miss-only rule for cards. All of that is spaced
//   repetition bookkeeping and none of it means anything in a game.
//
// So the split is real and it is about half the handler. That is the
// measurement; the tab is a decision that can now be made on it.
//
// ---------------------------------------------------------------------------
// `once` IS A MUTABLE OBJECT, DELIBERATELY.
//
// The view held these as refs, and they encode "this encounter has already
// been written down" — a fact that has to survive several calls within one
// position and reset when the position changes. Passing the refs' contents by
// value would silently log a row per retry; passing the refs themselves would
// tie this to React. A small mutable record is the honest middle, and the
// caller keeps owning when it resets.
// ---------------------------------------------------------------------------

import { logAnswer } from './progress';
import { recordMistake } from './mistakes';
import { positionKey } from '../domain/chess';
import { storedPhase, type RunState } from '../engine/session';

/** What this encounter has already written. Mutated in place. */
export type OnceThisItem = {
	/** A progress row has been logged for the item being answered. */
	logged: boolean;
	/** A mistake card has been made for it. */
	mistake: boolean;
};

/**
 * The part of a move's result this needs.
 *
 * Structural rather than importing `submitMove`'s return type: what is wanted
 * is the handful of fields below, and naming them says so.
 */
export type Outcome = {
	correct: boolean;
	cpLoss: number;
	played: string;
	novelty?: unknown;
};

/** A free-play loss this bad is worth turning into a card. */
const FREEPLAY_CARD_CP = 200;

export type RecordArgs = {
	/** The position that was answered — NOT the one we landed in. */
	before: RunState;
	out: Outcome;
	/** The move played, as UCI. */
	uci: string;
	runId: string;
	/** Any help was on screen, so a correct answer does not count. */
	assisted: boolean;
	/** The answer was shown outright. */
	revealed: boolean;
	once: OnceThisItem;
	/** SAN for a uci in a position. The view already has one; this takes it. */
	sanOf: (fen: string, uci: string) => string;
};

/**
 * Write down what just happened.
 *
 * Returns nothing: every effect is a database write, and a caller that wanted
 * to know what was written would be asking the wrong object.
 */
export function recordOutcome(args: RecordArgs): void {
	const { before, out, uci, runId, assisted, revealed, once, sanOf } = args;

	if (before.mode === 'free') {
		recordFreePlay(before, out, uci, runId, sanOf);
		return;
	}

	/*
	 * ONE ROW PER ENCOUNTER, and a NOVELTY IS NOT AN ANSWER.
	 *
	 * The position has not moved and the drill is still asking; whatever is
	 * played next is the answer, so `once.logged` is deliberately left false and
	 * that move still gets its row. Logging this one as `correct: false` was the
	 * first version, and it put the error back in through the progress record
	 * after the card had been kept out of the mistakes bin.
	 */
	if (!once.logged && !out.novelty) {
		once.logged = true;
		logAnswer({
			id: `${runId}-${before.path.length}-${Date.now()}`,
			ts: Date.now(),
			runId,
			path: [...before.path],
			ply: before.path.length,
			// The STORED label, via the one function that maps the in-memory model
			// onto the format on disk. See `storedPhase`.
			phase: storedPhase(before),
			correct: out.correct && !assisted,
			revealed,
			assisted,
			cpLoss: out.cpLoss,
		});
	}

	// NOT A MISS. Will: "it should not count as error … The card does not go
	// into the opening mistakes bin."
	if (out.novelty || out.correct) return;

	// Only the FIRST miss on a position becomes a card; retries of the same slip
	// within one encounter are one mistake, not several.
	if (once.mistake || !before.expected[0]) return;
	once.mistake = true;
	void recordMistake({
		fen: before.fen,
		positionKey: positionKey(before.fen),
		ourColour: before.ourColour,
		expectedUci: before.expected[0].uci,
		expectedSan: before.expected[0].san,
		playedSan: out.played,
		path: [...before.path],
		ply: before.path.length,
		phase: storedPhase(before),
		now: Date.now(),
	});
}

/**
 * Free play, which keeps a row for every measurable move.
 *
 * It is the ONLY source whose numbers feed the rating estimate, and an earlier
 * version skipped it entirely, which left the estimator with nothing to work
 * from.
 */
function recordFreePlay(
	before: RunState,
	out: Outcome,
	uci: string,
	runId: string,
	sanOf: (fen: string, uci: string) => string,
): void {
	/*
	 * A serious free-play error is as much worth repeating as a missed book
	 * move, and the engine can say what should have been played. Asynchronous
	 * and unawaited: the card is worth having and not worth making anyone wait
	 * for, and nothing downstream reads it this turn.
	 */
	if (out.cpLoss >= FREEPLAY_CARD_CP) {
		void (async () => {
			const best = await import('../engine/score').then((m) =>
				m.scoreMove(before.fen, uci, before.ourColour),
			);
			if (!best?.bestUci) return;
			void recordMistake({
				fen: before.fen,
				positionKey: positionKey(before.fen),
				ourColour: before.ourColour,
				expectedUci: best.bestUci,
				expectedSan: sanOf(before.fen, best.bestUci),
				playedSan: out.played,
				path: [...before.path],
				ply: before.path.length,
				phase: 'freeplay',
				now: Date.now(),
			});
		})();
	}

	// A NEGATIVE LOSS IS THE SENTINEL FOR "could not be measured". Logging it as
	// zero would record a perfect move every time the engine hiccupped, which is
	// how the rating estimate drifted upwards.
	if (out.cpLoss < 0) return;
	logAnswer({
		id: `${runId}-fp-${before.path.length}-${Date.now()}`,
		ts: Date.now(),
		runId,
		path: [...before.path],
		ply: before.path.length,
		phase: 'freeplay',
		// A free-play move is not right or wrong against anything — there is no
		// expected set. It is logged for its COST, which is the `cpLoss`, and
		// `correct: true` keeps it out of the accuracy counts that are about
		// recall.
		correct: true,
		revealed: false,
		assisted: false,
		cpLoss: out.cpLoss,
	});
}
