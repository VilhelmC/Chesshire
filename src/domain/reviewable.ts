// The things worth looking back at, from wherever they came from.
//
// ---------------------------------------------------------------------------
// Review could only replay TRAINING RUNS. But the games most worth going back
// over are the real ones — the ones with a result, an opponent and something at
// stake — and those were reachable only as a list of mistake cards, one
// position at a time, with no way to see how the position was arrived at.
//
// A run and an imported game are the same object for this purpose: a sequence
// of moves, an evaluation after each, and a side that was you. Making that
// explicit means Review works on both without knowing which it has.
//
// The evaluations are stored White-POV for imported games and our-POV for runs,
// which is exactly the kind of difference that produces a graph that is right
// half the time. Normalising happens here, once.
// ---------------------------------------------------------------------------

export type ReviewSource = 'run' | 'game';

export type Reviewable = {
	id: string;
	source: ReviewSource;
	/** When it happened. */
	ts: number;
	label: string;
	moves: string[];
	/** Evaluation after each ply, OUR point of view. */
	evals: (number | null)[];
	/** Centipawns lost on each of our plies, keyed by ply index. */
	losses: Record<number, number>;
	ourColour: 'w' | 'b';
	/** Where to see the original, for imported games. */
	url?: string;
	result?: 'win' | 'loss' | 'draw';
};

export type RunLike = {
	id: string;
	ts: number;
	opening?: string | null;
	moves?: string[];
	evals?: (number | null)[];
	losses?: Record<number, number>;
	ourColour?: 'w' | 'b';
	plies: number;
	finished: string | null;
};

export type GameLike = {
	id: string;
	playedAt: number;
	opponent: string;
	platform: string;
	url: string;
	result: 'win' | 'loss' | 'draw';
	moves?: string[];
	/** WHITE's point of view — the storage convention for imported games. */
	evals?: (number | null)[];
	ourColour?: 'w' | 'b';
};

/** A training run, if it kept enough to replay. */
export function fromRun(r: RunLike): Reviewable | null {
	if (!r.moves?.length) return null;
	return {
		id: r.id,
		source: 'run',
		ts: r.ts,
		label: `${r.opening ?? 'Training run'} · ${r.plies} plies · ${r.finished ?? 'unfinished'}`,
		moves: r.moves,
		evals: r.evals ?? [],
		losses: r.losses ?? {},
		ourColour: r.ourColour ?? 'w',
	};
}

/** An imported game, if it kept enough to replay. */
export function fromGame(g: GameLike): Reviewable | null {
	if (!g.moves?.length) return null;
	const ourColour = g.ourColour ?? 'w';

	// White-POV in storage, our-POV here. Getting this wrong would put the
	// evaluation graph upside down for every game played as Black.
	const evals = (g.evals ?? []).map((e) =>
		e === null || e === undefined ? null : ourColour === 'w' ? e : -e,
	);

	return {
		id: g.id,
		source: 'game',
		ts: g.playedAt,
		label: `${g.platform} vs ${g.opponent} · ${g.result}`,
		moves: g.moves,
		evals,
		losses: lossesFrom(evals, ourColour),
		ourColour,
		url: g.url,
		result: g.result,
	};
}

/**
 * Centipawns given up on each of our moves, derived from the evaluations.
 *
 * Runs record this as they go; imported games never did, because nothing was
 * watching at the time. It falls out of the evaluations either way, and doing
 * it here means Review does not have to care which kind of thing it is holding.
 *
 * Keyed by the ply index the move was played AT, matching what runs store.
 */
export function lossesFrom(evals: (number | null)[], ourColour: 'w' | 'b'): Record<number, number> {
	const out: Record<number, number> = {};
	for (let i = 0; i < evals.length; i++) {
		const isOurs = (i % 2 === 0) === (ourColour === 'w');
		if (!isOurs) continue;
		const after = evals[i];
		const before = i === 0 ? 15 : evals[i - 1];
		if (after === null || before === null || after === undefined || before === undefined) continue;
		// Our-POV already, so a drop is a loss whichever colour we are.
		out[i] = Math.max(0, before - after);
	}
	return out;
}

/** Everything reviewable, newest first. */
export function reviewables(runs: RunLike[], games: GameLike[]): Reviewable[] {
	return [
		...runs.map(fromRun),
		...games.map(fromGame),
	]
		.filter((r): r is Reviewable => r !== null)
		.sort((a, b) => b.ts - a.ts);
}
