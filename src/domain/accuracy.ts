// Accuracy, by Lichess's method.
//
// ---------------------------------------------------------------------------
// WHY THEIRS AND NOT OURS
//
// Chess.com's CAPS2 is unpublished, so any "Chess.com accuracy" is somebody's
// reverse engineering. Lichess's is open, and that has a property worth more
// than elegance: a number computed here can be checked against the number the
// same game shows on Lichess. A metric you can audit against an independent
// implementation is a different kind of claim from one you can only trust.
//
// The constants below are taken from the SOURCE, not from the documentation
// page, because the two disagree — the page rounds the constants and omits the
// `+1` uncertainty bonus entirely. See METRICS.md §2.
//
// WHY WIN PERCENTAGE AND NOT CENTIPAWNS
//
// A 300-centipawn swing means nothing in a position that is already won and
// everything near equality. Converting to a win probability first is what makes
// a "loss" mean the same thing everywhere on the scale — and it is why Lichess
// moved its own mistake thresholds off centipawns years ago.
// ---------------------------------------------------------------------------

/** Evaluations are clamped to this before anything else. Mate is exactly this. */
export const CP_CEILING = 1000;

/**
 * The starting position is scored +15, not 0.
 *
 * Lichess's own chain begins there, and every accuracy is measured relative to
 * the position before it — so starting from 0 would score White's first move
 * against a position that does not exist.
 */
export const CP_INITIAL = 15;

const WIN_MULTIPLIER = -0.00368208;

/**
 * Centipawns (White's point of view) to win percentage, 0–100.
 *
 * The multiplier is a logistic fitted over ~75,000 positions from 2300+ rated
 * rapid games. Worth remembering when reading a number produced for a game in
 * the 1400 band: the curve was calibrated on stronger players, so it is a
 * consistent yardstick rather than a personalised one.
 */
export function winPercent(cp: number): number {
	const clamped = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
	const chances = 2 / (1 + Math.exp(WIN_MULTIPLIER * clamped)) - 1;
	return 50 + 50 * Math.max(-1, Math.min(1, chances));
}

/** A mate score, in the only terms the rest of this cares about. */
export function winPercentOfMate(movesToMate: number): number {
	return winPercent(movesToMate >= 0 ? CP_CEILING : -CP_CEILING);
}

const ACC_A = 103.1668100711649;
const ACC_K = 0.04354415386753951;
const ACC_B = -3.166924740191411;

/**
 * One move's accuracy, from the win percentages either side of it.
 *
 * Both arguments are from the MOVER's point of view. A move that improves your
 * own chances scores exactly 100 — you cannot be penalised for a position
 * getting better.
 *
 * The `+1` is Lichess's "uncertainty bonus", present in their code and absent
 * from their published page. It exists because the analysis itself is
 * imperfect, and it means a swing has to exceed about two thirds of a
 * percentage point before accuracy drops below 100 at all.
 */
export function moveAccuracy(before: number, after: number): number {
	if (after >= before) return 100;
	const raw = ACC_A * Math.exp(-ACC_K * (before - after)) + ACC_B;
	return Math.max(0, Math.min(100, raw + 1));
}

// ---------------------------------------------------------------------------
// Combining moves into a game
// ---------------------------------------------------------------------------

/** Population standard deviation — divide by n, not n-1, as Lichess does. */
function stdDev(xs: number[]): number {
	if (!xs.length) return 0;
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

function windowsOf<T>(xs: T[], size: number): T[][] {
	if (xs.length < size) return [xs];
	const out: T[][] = [];
	for (let i = 0; i + size <= xs.length; i++) out.push(xs.slice(i, i + size));
	return out;
}

export type GameAccuracy = {
	white: number | null;
	black: number | null;
	/** Per-move accuracy in play order, for a graph or a move list. */
	moves: { ply: number; colour: 'w' | 'b'; accuracy: number }[];
};

/**
 * Accuracy for both sides of a game.
 *
 * @param evals win-percentage-able centipawn scores from WHITE's point of view,
 *              index i being the position AFTER ply i. Nulls are not allowed;
 *              a game with gaps is not measurable and callers should say so
 *              rather than interpolate.
 *
 * The combination is the strange part, and it is deliberate rather than
 * arbitrary: the arithmetic mean of a volatility-weighted mean and a harmonic
 * mean. The weighting says moves made while the game was actually swinging
 * matter more than moves made in a settled position. The harmonic mean is what
 * stops one catastrophe being averaged away by forty quiet moves.
 */
export function gameAccuracy(evals: number[]): GameAccuracy {
	if (!evals.length) return { white: null, black: null, moves: [] };

	// The chain starts before the first move was played.
	const series = [winPercent(CP_INITIAL), ...evals.map(winPercent)];

	const windowSize = Math.max(2, Math.min(8, Math.floor(evals.length / 10)));
	const raw = windowsOf(series, windowSize);
	// Front-padding: the first window is repeated so that the opening moves are
	// weighted at all rather than falling outside every window.
	const pad = Math.max(0, Math.min(windowSize, series.length) - 2);
	const windows = [...Array.from({ length: pad }, () => raw[0]), ...raw];

	const moves: GameAccuracy['moves'] = [];
	const byColour: Record<'w' | 'b', { acc: number[]; w: number[] }> = {
		w: { acc: [], w: [] },
		b: { acc: [], w: [] },
	};

	for (let i = 0; i + 1 < series.length; i++) {
		const prev = series[i];
		const next = series[i + 1];
		// Ply i+1 is White's when i is even. Win% is stored White-POV, so Black's
		// move is scored on the flipped pair.
		const colour: 'w' | 'b' = i % 2 === 0 ? 'w' : 'b';
		const accuracy =
			colour === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);

		const weight = Math.max(0.5, Math.min(12, stdDev(windows[Math.min(i, windows.length - 1)])));
		byColour[colour].acc.push(accuracy);
		byColour[colour].w.push(weight);
		moves.push({ ply: i + 1, colour, accuracy });
	}

	return {
		white: combine(byColour.w.acc, byColour.w.w),
		black: combine(byColour.b.acc, byColour.b.w),
		moves,
	};
}

function combine(acc: number[], weights: number[]): number | null {
	if (!acc.length) return null;
	const totalWeight = weights.reduce((a, b) => a + b, 0);
	const weighted = totalWeight
		? acc.reduce((sum, a, i) => sum + a * weights[i], 0) / totalWeight
		: acc.reduce((a, b) => a + b, 0) / acc.length;
	// max(1, …) both avoids a division by zero and stops a single 0% move
	// dragging the harmonic mean to nothing.
	const harmonic = acc.length / acc.reduce((sum, a) => sum + 1 / Math.max(1, a), 0);
	return (weighted + harmonic) / 2;
}

// ---------------------------------------------------------------------------
// Judgements
// ---------------------------------------------------------------------------

/**
 * Lichess's thresholds, as drops in win percentage rather than centipawns.
 *
 * Centipawn thresholds are the model Lichess abandoned, and for a good reason:
 * they flag swings in positions that were already decided and miss the ones
 * that actually changed the game. Ours still uses centipawns — see
 * METRICS.md §3.
 */
export const JUDGEMENT = { inaccuracy: 10, mistake: 20, blunder: 30 } as const;

export type Judgement = 'blunder' | 'mistake' | 'inaccuracy' | null;

/** How bad a move was, from the win percentages either side, mover's POV. */
export function judge(before: number, after: number): Judgement {
	const drop = before - after;
	if (drop >= JUDGEMENT.blunder) return 'blunder';
	if (drop >= JUDGEMENT.mistake) return 'mistake';
	if (drop >= JUDGEMENT.inaccuracy) return 'inaccuracy';
	return null;
}

/** Counts per side, for a game summary. */
export function countJudgements(evals: number[]): Record<'w' | 'b', Record<string, number>> {
	const series = [winPercent(CP_INITIAL), ...evals.map(winPercent)];
	const out = {
		w: { blunder: 0, mistake: 0, inaccuracy: 0 },
		b: { blunder: 0, mistake: 0, inaccuracy: 0 },
	};
	for (let i = 0; i + 1 < series.length; i++) {
		const colour: 'w' | 'b' = i % 2 === 0 ? 'w' : 'b';
		const [before, after] =
			colour === 'w' ? [series[i], series[i + 1]] : [100 - series[i], 100 - series[i + 1]];
		const j = judge(before, after);
		if (j) out[colour][j]++;
	}
	return out;
}
