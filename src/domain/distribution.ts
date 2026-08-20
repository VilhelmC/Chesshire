// What players at your band actually play here.
//
// ---------------------------------------------------------------------------
// A different question from "what is best"
//
// The candidate list already answers the engine's question: which moves are
// good, ranked by evaluation. This answers the human one: which moves get
// PLAYED, and how they score when they are.
//
// For this app the second is the more useful of the two, because the whole
// premise is preparing for what your opponent will do rather than for what a
// 3500-rated engine would. A move played in one game in forty is not worth
// preparing for however good it is; a mediocre move played in one game in four
// is the one you will actually meet on Saturday.
//
// The data is already being fetched — the opponent's replies come from exactly
// this response. Showing it costs a render, not a request.
// ---------------------------------------------------------------------------

import type { ExplorerMove, ExplorerResponse } from './types';

export type MoveShare = {
	uci: string;
	san: string;
	/** Games in which this move was played. */
	games: number;
	/** Share of all games from this position, 0–1. */
	share: number;
	/**
	 * Expected score for the side to move, 0–1 — a win is 1, a draw a half.
	 *
	 * Not a win rate. "Wins 48%" is ambiguous about draws, and in openings the
	 * draws are where most of the difference between two moves lives.
	 */
	score: number;
	/** Average rating of players who chose it, when the explorer reports one. */
	rating: number | null;
};

export type Distribution = {
	moves: MoveShare[];
	total: number;
	/** Expected score across every move, i.e. how the position does in general. */
	score: number | null;
};

function gamesOf(m: { white: number; draws: number; black: number }): number {
	return m.white + m.draws + m.black;
}

function scoreFor(m: { white: number; draws: number; black: number }, mover: 'w' | 'b'): number {
	const total = gamesOf(m);
	if (!total) return 0;
	const wins = mover === 'w' ? m.white : m.black;
	return (wins + m.draws / 2) / total;
}

/**
 * The explorer's reply, as shares.
 *
 * Sorted by how often the move is played, not by how well it scores. The
 * ordering is the message: this is a list of what you will meet, and putting
 * the best-scoring rarity at the top would quietly turn it back into an
 * engine list.
 */
export function distributionOf(
	response: ExplorerResponse | null | undefined,
	mover: 'w' | 'b',
): Distribution {
	if (!response?.moves?.length) return { moves: [], total: 0, score: null };

	const total = response.moves.reduce((n, m) => n + gamesOf(m), 0);
	if (!total) return { moves: [], total: 0, score: null };

	const moves = response.moves
		.map((m: ExplorerMove) => ({
			uci: m.uci,
			san: m.san,
			games: gamesOf(m),
			share: gamesOf(m) / total,
			score: scoreFor(m, mover),
			rating: typeof m.averageRating === 'number' ? m.averageRating : null,
		}))
		.sort((a, b) => b.games - a.games);

	return { moves, total, score: scoreFor(response, mover) };
}

/**
 * How many of the listed moves cover a given share of games.
 *
 * The practical question behind a distribution: how much do I have to know to
 * be ready for most of what happens? Four moves covering 90% is a manageable
 * evening; fourteen covering 90% is a different opening.
 */
export function movesToCover(d: Distribution, fraction = 0.9): number {
	let sum = 0;
	for (let i = 0; i < d.moves.length; i++) {
		sum += d.moves[i].share;
		if (sum >= fraction) return i + 1;
	}
	return d.moves.length;
}

/** Percent, rounded the way a reader expects, with a floor so nothing reads as never. */
export function sharePercent(share: number): string {
	const pct = share * 100;
	if (pct >= 10) return `${Math.round(pct)}%`;
	if (pct >= 1) return `${pct.toFixed(1)}%`;
	return '<1%';
}
