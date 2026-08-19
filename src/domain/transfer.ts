// Does any of this work?
//
// ---------------------------------------------------------------------------
// Every other number in the app measures how you do INSIDE the app. That is
// circular: drilling a position until you can answer it proves you can answer
// it when asked. The question the app exists to answer is whether that carries
// into games where nobody is asking.
//
// Now answerable, because both halves exist: `answers` records what you drilled
// and when, and imported games record what you actually played and when. So for
// any position on the tree:
//
//   mistakes per game through it, BEFORE you first drilled it
//   mistakes per game through it, AFTER
//
// The denominator is the whole point. "Two mistakes in the Italian last month
// and none this month" is meaningless if you played nine Italians then and one
// now. Games that reached the position are counted whether or not they went
// wrong, which is why the game's moves have to be stored (db.ts).
//
// What this deliberately will NOT do is present a number it cannot support.
// Splitting a small sample in two produces two smaller samples, and at this
// volume the answer is usually "not yet". Saying so is the useful output;
// inventing a percentage is not.
// ---------------------------------------------------------------------------

export type PlayedGame = {
	id: string;
	/** SAN moves. Absent on rows recorded before moves were kept. */
	moves?: string[];
	playedAt: number;
	/** Mistakes found in this game, as SAN paths to the position each was made in. */
	mistakePaths: string[][];
};

export type DrillEvent = {
	path: string[];
	ts: number;
};

export type TransferWindow = {
	games: number;
	mistakes: number;
	/** Mistakes per game, or null with no games. */
	rate: number | null;
};

export type TransferResult = {
	path: string[];
	/** When this position was first drilled, which is what splits the windows. */
	firstDrilled: number | null;
	before: TransferWindow;
	after: TransferWindow;
	/** Enough games on both sides to be worth reading. */
	meaningful: boolean;
	/**
	 * Change in mistakes per game, negative meaning fewer. Null unless
	 * `meaningful` — a difference computed from two games is noise with a
	 * decimal point on it.
	 */
	change: number | null;
};

/** Games needed on EACH side before a comparison is offered. */
export const MIN_GAMES_PER_SIDE = 4;

function startsWith(path: string[], prefix: string[]): boolean {
	if (prefix.length > path.length) return false;
	return prefix.every((s, i) => path[i] === s);
}

const emptyWindow = (): TransferWindow => ({ games: 0, mistakes: 0, rate: null });

/**
 * The transfer measurement for one position.
 *
 * A game counts towards the position if its moves passed through it. A mistake
 * counts if it was made at that position or anywhere below it — drilling the
 * Two Knights should show up as fewer mistakes anywhere in the Two Knights, not
 * only on the exact move drilled.
 */
export function transferAt(
	path: string[],
	games: PlayedGame[],
	drills: DrillEvent[],
): TransferResult {
	const drilled = drills
		.filter((d) => startsWith(d.path, path))
		.reduce<number | null>((min, d) => (min === null ? d.ts : Math.min(min, d.ts)), null);

	const before = emptyWindow();
	const after = emptyWindow();

	for (const g of games) {
		// No moves recorded means we cannot tell whether the game reached the
		// position. Excluded from both windows rather than assumed into one.
		if (!g.moves?.length) continue;
		if (!startsWith(g.moves, path)) continue;

		const w = drilled !== null && g.playedAt >= drilled ? after : before;
		w.games++;
		w.mistakes += g.mistakePaths.filter((m) => startsWith(m, path)).length;
	}

	for (const w of [before, after]) w.rate = w.games ? w.mistakes / w.games : null;

	const meaningful =
		drilled !== null && before.games >= MIN_GAMES_PER_SIDE && after.games >= MIN_GAMES_PER_SIDE;

	return {
		path,
		firstDrilled: drilled,
		before,
		after,
		meaningful,
		change: meaningful ? (after.rate as number) - (before.rate as number) : null,
	};
}

/**
 * Every position worth reporting on, best evidence first.
 *
 * Candidates are the positions actually drilled; the ones with enough games on
 * both sides come first, then those still accumulating.
 */
export function transferReport(
	candidates: string[][],
	games: PlayedGame[],
	drills: DrillEvent[],
): TransferResult[] {
	return candidates
		.map((p) => transferAt(p, games, drills))
		.sort((a, b) => {
			if (a.meaningful !== b.meaningful) return a.meaningful ? -1 : 1;
			return b.before.games + b.after.games - (a.before.games + a.after.games);
		});
}

/**
 * How much of the game history can be used at all.
 *
 * Rows imported before moves were stored cannot be placed on the tree. Reported
 * rather than quietly reducing every denominator.
 */
export function coverage(games: PlayedGame[]): { usable: number; unusable: number } {
	const usable = games.filter((g) => g.moves?.length).length;
	return { usable, unusable: games.length - usable };
}

/** Plain words for a change in mistakes per game. */
export function describeChange(r: TransferResult): string {
	if (!r.meaningful || r.change === null) {
		const need = MIN_GAMES_PER_SIDE;
		if (r.firstDrilled === null) return 'not drilled yet';
		return `${r.before.games} games before, ${r.after.games} after — ${need} of each needed`;
	}
	const b = (r.before.rate as number).toFixed(2);
	const a = (r.after.rate as number).toFixed(2);
	if (Math.abs(r.change) < 0.05) return `unchanged (${b} → ${a} mistakes per game)`;
	return r.change < 0
		? `${b} → ${a} mistakes per game`
		: `${b} → ${a} mistakes per game — worse, not better`;
}
