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
// TWO conventions had to be reconciled, and both of them had already caused a
// wrong number on screen:
//
//  * POINT OF VIEW. Imported games store evaluations from WHITE's side, because
//    that is what the sites send; runs store them from ours. Mixing the two puts
//    the graph upside down for every game played as Black — right half the time,
//    which is the worst kind of wrong for a number nobody can easily check.
//
//  * INDEXING. Runs index by ply COUNT, so `evals[1]` is the position after the
//    first move and `evals[0]` is the start. Imported games index from zero, so
//    their `evals[0]` is the position after the first move. Off by one, silently,
//    in one of the two sources.
//
// Both are normalised here, at the boundary, to: OUR point of view, `evals[i]`
// is the position after i plies. Nothing downstream gets a second opinion, and
// nothing downstream stores losses of its own — they are derived from these.
// ---------------------------------------------------------------------------

import { accuracyPercent } from './review';
import { annotate, lossesOf, punishTally } from './annotate';

export type ReviewSource = 'run' | 'game';

export type Reviewable = {
	id: string;
	source: ReviewSource;
	/** When it happened. */
	ts: number;
	/** What it was — an opponent, or an opening. The thing you scan for. */
	title: string;
	/** The rest: platform and result, or length and how it ended. */
	detail: string;
	/** `title · detail`, for anywhere that wants one string. */
	label: string;
	moves: string[];
	/**
	 * OUR point of view, indexed by ply count: `evals[0]` is the starting
	 * position and `evals[i]` is the position after i plies.
	 *
	 * Null where a ply was never evaluated — which is not the same as level, and
	 * must never be read as it.
	 */
	evals: (number | null)[];
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
	const title = r.opening ?? 'Training run';
	const detail = `${r.plies} plies · ${r.finished ?? 'unfinished'}`;
	return {
		id: r.id,
		source: 'run',
		ts: r.ts,
		title,
		detail,
		label: `${title} · ${detail}`,
		moves: r.moves,
		// Already our-POV, and already indexed by ply count — a run writes
		// `evals[path.length]` after each move, so index 0 is the start.
		evals: r.evals ?? [],
		ourColour: r.ourColour ?? 'w',
	};
}

/** An imported game, if it kept enough to replay. */
export function fromGame(g: GameLike): Reviewable | null {
	if (!g.moves?.length) return null;
	const ourColour = g.ourColour ?? 'w';

	// White-POV in storage, our-POV here. Getting this wrong would put the
	// evaluation graph upside down for every game played as Black.
	//
	// The leading null is the index shift: the sites' arrays start at the position
	// AFTER the first move, and everything here counts plies. Null rather than a
	// number because nothing measured the starting position — annotate() fills it
	// with the known starting value, which is a different claim from a reading.
	const evals: (number | null)[] = [
		null,
		...(g.evals ?? []).map((e) =>
			e === null || e === undefined ? null : ourColour === 'w' ? e : -e,
		),
	];

	const title = `vs ${g.opponent}`;
	const detail = `${g.platform} · ${g.result}`;

	return {
		id: g.id,
		source: 'game',
		ts: g.playedAt,
		title,
		detail,
		label: `${title} · ${detail}`,
		moves: g.moves,
		evals,
		ourColour,
		url: g.url,
		result: g.result,
	};
}

export type ReviewSummary = {
	id: string;
	source: ReviewSource;
	ts: number;
	title: string;
	detail: string;
	/** Null when nothing in it was scored — not zero. */
	accuracy: number | null;
	/** Theirs, on the same basis, so the row says who was playing well. */
	opponentAccuracy: number | null;
	/** How many of our moves the accuracy is computed from. */
	scored: number;
	plies: number;
	/** Chances they gave us, and the ones we let go. */
	offered: number;
	missed: number;
	result?: 'win' | 'loss' | 'draw';
	url?: string;
};

/**
 * One row of the list.
 *
 * Accuracy is here rather than in the row component because a list of games
 * whose only difference is the date is a list you cannot choose from: the
 * number is the reason to open one game rather than another. Null when nothing
 * was scored, which is a different statement from 0% and must not print as one.
 */
export function summarise(r: Reviewable): ReviewSummary {
	const a = annotate(r.evals, r.ourColour);
	const ours = lossesOf(a, 'us');
	const tally = punishTally(a);
	return {
		id: r.id,
		source: r.source,
		ts: r.ts,
		title: r.title,
		detail: r.detail,
		accuracy: accuracyPercent(ours),
		opponentAccuracy: accuracyPercent(lossesOf(a, 'them')),
		scored: ours.length,
		plies: r.moves.length,
		offered: tally.offered,
		missed: tally.missed,
		result: r.result,
		url: r.url,
	};
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
