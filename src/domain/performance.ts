// Accuracy across your games and your training, as a diagnostic.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE THE TRANSFER MEASUREMENT
//
// Transfer (domain/transfer.ts) answers the question the app is FOR — does
// drilling change what you play — and it is the only number here that is not
// circular. It is also slow: four games either side of a drilled position, so
// weeks before it says anything, and it says it about one position at a time.
//
// That slowness is a reason to have faster numbers, not a reason to trust them
// more. What these are for is the other half of the job: **telling you what to
// practise next.** A metric that only says "you are doing well" is
// gamification; a metric that says "your accuracy collapses after move 15" is
// feedback. Everything here is chosen to point somewhere.
//
// All of it uses Lichess's published method (domain/accuracy.ts) rather than an
// invention of ours, so a number here can be checked against the same game on
// Lichess.
// ---------------------------------------------------------------------------

import { gameAccuracy, countJudgements, winPercent, judge } from './accuracy';

export type MeasurableGame = {
	id: string;
	playedAt: number;
	ourColour: 'w' | 'b';
	/** White's point of view, index i after ply i. */
	evals?: (number | null)[];
	moves?: string[];
};

export type GameScore = {
	id: string;
	playedAt: number;
	accuracy: number;
	blunders: number;
	mistakes: number;
	inaccuracies: number;
	/** Average centipawn loss, our moves only. */
	acpl: number;
};

/**
 * The evaluations this game can actually be scored from, or null.
 *
 * ---------------------------------------------------------------------------
 * A TRAILING gap is not the same as a gap in the middle, and treating them
 * alike threw away most of the history.
 *
 * The import walks the positions either side of each of OUR moves. When the
 * opponent plays the last move of the game — which is about half of all games —
 * nothing ever evaluates the final position, so the last entry is null. The
 * original check demanded every ply and rejected the entire game over it.
 *
 * That final position is the one after THEIR move. It contributes nothing to
 * our accuracy. Dropping it costs nothing; dropping the game cost fifteen games
 * out of twenty.
 *
 * A gap in the MIDDLE is still fatal, and still should be: skip the plies
 * nobody looked at and the average silently describes the analysis rather than
 * the play.
 * ---------------------------------------------------------------------------
 */
export function measurableEvals(g: MeasurableGame): number[] | null {
	if (!g.evals?.length || !g.moves?.length) return null;

	// Trim trailing gaps, then require the remainder to be solid.
	let end = Math.min(g.evals.length, g.moves.length);
	while (end > 0 && (g.evals[end - 1] === null || g.evals[end - 1] === undefined)) end--;

	if (end < MIN_PLIES) return null;
	const head = g.evals.slice(0, end);
	if (head.some((e) => e === null || e === undefined)) return null;
	return head as number[];
}

/** Below this there is not enough game to say anything about how it was played. */
export const MIN_PLIES = 6;

export function isMeasurable(g: MeasurableGame): boolean {
	return measurableEvals(g) !== null;
}

/**
 * Why a game contributes nothing, in words.
 *
 * "15 of 20 excluded" with no reason is the kind of number this project has
 * spent a lot of effort not shipping. Each exclusion has a cause and each cause
 * has a different remedy.
 */
export function exclusionReason(g: MeasurableGame): string | null {
	if (!g.moves?.length) return 'no moves recorded — imported before moves were kept';
	if (!g.evals?.length) return 'no evaluations — imported before they were kept';

	let end = Math.min(g.evals.length, g.moves.length);
	while (end > 0 && (g.evals[end - 1] === null || g.evals[end - 1] === undefined)) end--;

	if (end < MIN_PLIES) return 'too short to score';
	if (g.evals.slice(0, end).some((e) => e === null || e === undefined)) {
		return 'analysis stopped partway — re-import to finish it';
	}
	return null;
}

export function scoreGame(g: MeasurableGame): GameScore | null {
	const evals = measurableEvals(g);
	if (!evals) return null;

	const acc = gameAccuracy(evals);
	const mine = g.ourColour === 'w' ? acc.white : acc.black;
	if (mine === null) return null;

	const counts = countJudgements(evals)[g.ourColour];

	return {
		id: g.id,
		playedAt: g.playedAt,
		accuracy: mine,
		blunders: counts.blunder,
		mistakes: counts.mistake,
		inaccuracies: counts.inaccuracy,
		acpl: acplOf(evals, g.ourColour),
	};
}

/**
 * Average centipawn loss over our moves.
 *
 * Kept alongside accuracy rather than instead of it, because they fail
 * differently: ACPL is an arithmetic mean and forgives one catastrophe among
 * forty quiet moves, while accuracy's harmonic component does not. Two numbers
 * that disagree are telling you something a single number would have hidden.
 */
export function acplOf(evals: number[], ourColour: 'w' | 'b'): number {
	const losses: number[] = [];
	// Ply i+1 is White's when i is even; index i-1 is the position before it.
	for (let i = 0; i < evals.length; i++) {
		const isOurs = (i % 2 === 0) === (ourColour === 'w');
		if (!isOurs) continue;
		const before = i === 0 ? 15 : evals[i - 1];
		const after = evals[i];
		const sign = ourColour === 'w' ? 1 : -1;
		losses.push(Math.max(0, (before - after) * sign));
	}
	if (!losses.length) return 0;
	return Math.round(losses.reduce((a, b) => a + b, 0) / losses.length);
}

export type PerformanceReport = {
	scored: GameScore[];
	/** Games with no usable evaluations — reported, never quietly dropped. */
	unmeasured: number;
	/** Why, counted by cause, so the remedy is visible rather than guessed at. */
	reasons: { reason: string; count: number }[];
	/** Mean accuracy over the scored games, or null if there are none. */
	accuracy: number | null;
	/** Mean accuracy over the most recent `RECENT` games. */
	recent: number | null;
	blundersPerGame: number | null;
};

/** Enough games that one disaster does not define the average. */
export const RECENT = 10;

export function performanceReport(games: MeasurableGame[]): PerformanceReport {
	const scored = games
		.map(scoreGame)
		.filter((s): s is GameScore => s !== null)
		.sort((a, b) => b.playedAt - a.playedAt);

	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

	const tally = new Map<string, number>();
	for (const g of games) {
		const why = exclusionReason(g);
		if (why) tally.set(why, (tally.get(why) ?? 0) + 1);
	}

	return {
		scored,
		unmeasured: games.length - scored.length,
		reasons: [...tally.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count),
		accuracy: mean(scored.map((s) => s.accuracy)),
		recent: mean(scored.slice(0, RECENT).map((s) => s.accuracy)),
		blundersPerGame: mean(scored.map((s) => s.blunders)),
	};
}

// ---------------------------------------------------------------------------
// Where it goes wrong — the diagnostic half
// ---------------------------------------------------------------------------

export type PhaseBand = { from: number; to: number; label: string };

/**
 * Bands by move number rather than by named phase.
 *
 * "Opening / middlegame / endgame" needs a definition of where each begins, and
 * every definition is arguable. Move ranges are arbitrary too, but they are
 * arbitrary in a way the reader can see, and for this app the interesting
 * question is a specific one: how far into a game does your play hold up.
 */
export const BANDS: PhaseBand[] = [
	{ from: 1, to: 10, label: 'moves 1–10' },
	{ from: 11, to: 20, label: 'moves 11–20' },
	{ from: 21, to: 30, label: 'moves 21–30' },
	{ from: 31, to: 999, label: 'move 31+' },
];

export type BandScore = { label: string; accuracy: number | null; moves: number };

/**
 * Accuracy by stage of the game.
 *
 * This is the number most likely to change what someone does tomorrow. "78%
 * overall" is a scoreboard; "94% to move 10 and 61% after move 20" is an
 * instruction.
 */
export function accuracyByBand(games: MeasurableGame[]): BandScore[] {
	const buckets = BANDS.map(() => [] as number[]);

	for (const g of games) {
		const evals = measurableEvals(g);
		if (!evals) continue;
		for (const m of gameAccuracy(evals).moves) {
			if (m.colour !== g.ourColour) continue;
			const moveNo = Math.ceil(m.ply / 2);
			const idx = BANDS.findIndex((b) => moveNo >= b.from && moveNo <= b.to);
			if (idx >= 0) buckets[idx].push(m.accuracy);
		}
	}

	return BANDS.map((b, i) => ({
		label: b.label,
		moves: buckets[i].length,
		// Below a handful of moves a band average is noise with a decimal point.
		accuracy:
			buckets[i].length >= MIN_MOVES_PER_BAND
				? buckets[i].reduce((a, x) => a + x, 0) / buckets[i].length
				: null,
	}));
}

/** Fewer than this in a band and the average says nothing. */
export const MIN_MOVES_PER_BAND = 10;

/**
 * The single most useful sentence the numbers can produce.
 *
 * Returns the band where play falls off most sharply, or null when there is not
 * enough to say. Deliberately one thing: a list of six weaknesses is a list
 * nobody acts on.
 */
export function weakestBand(bands: BandScore[]): BandScore | null {
	const usable = bands.filter((b) => b.accuracy !== null);
	if (usable.length < 2) return null;
	return usable.reduce((worst, b) =>
		(b.accuracy as number) < (worst.accuracy as number) ? b : worst,
	);
}

/** Re-exported so callers need one import for the whole vocabulary. */
export { winPercent, judge };
