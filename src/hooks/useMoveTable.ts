// Everything known about the moves in a position, fetched once, for any tab.
//
// ---------------------------------------------------------------------------
// WHAT THE CHIPS DO, AND WHAT THEY STOPPED DOING.
//
// Will: "Show moves table: why are not all moves shown with eval score?
// regardless of whether engine is toggled. Book moves and played moves should
// also be eligible for eval? Why are not all moves listed with 'played'
// statistics? … It irritates me that the table has different grammars for
// different categories."
//
// The cause was that each chip was wired to a FETCH as well as to a filter.
// `engine` off meant no search had been run, so no row anywhere in the table
// had an evaluation; `played` off meant the explorer had never been asked, so
// no row had a game count. Which made the columns mean different things
// depending on which buttons happened to be down — a book move showed a blank
// eval not because it is unevaluable but because nobody had pressed the other
// button.
//
// So the chips now filter ROWS and nothing else. When the table is up, all
// three sources are consulted, every row carries every column it can, and
// turning a chip off removes rows rather than facts. That also costs nothing
// new in the normal case: the default has always been all three on.
//
// ---------------------------------------------------------------------------
// AND "BOOK" MEANS THE SAME THING IN BOTH TABS NOW.
//
// Will: "you added a 'show moves' button in Mistakes, but it does not have the
// 'book' filter category. It should be unified across tabs."
//
// Mistakes could not offer one because Train's `line` source was the RUN's
// expected list — what the drill happens to accept, which is a function of the
// strictness setting — and a mistake card has no run behind it. Here `line` is
// theory at this position, read off the explorer that is being fetched anyway:
// a fact about chess rather than about a session, so both tabs can have it and
// they cannot disagree about it.
//
// This also fixes a wart on the old Train rule, which had to exclude itself
// out of book: `expected` there is every legal move, so tagging them all "the
// line" put the label on thirty rows and made it mean nothing. Theory at a
// position with no theory is simply empty.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { candidateMoves, type Candidate } from '../engine/candidates';
import { fetchExplorer } from '../data/explorer';
import { classifyBook, isTheory } from '../domain/book';
import { distributionOf, type Distribution } from '../domain/distribution';
import { colourOfFen } from '../domain/notation';
import { mergeMoves, type MoveRow } from '../domain/moveTable';
import type { ExplorerResponse } from '../domain/types';

/**
 * How many lines the engine is asked for: more than any position has.
 *
 * ---------------------------------------------------------------------------
 * Will: "there are still some book moves that are not getting assigned an eval
 * score."
 *
 * This was 24, chosen as "surely enough". It was not: the Italian after 3.Bc4
 * has 31 legal moves, so seven were being dropped, and a rare-but-real piece of
 * theory — the kind that IS worth showing an evaluation for, because you want
 * to know why nobody plays it — is exactly the kind that falls outside the top
 * twenty-four.
 *
 * The honest number is "all of them", and it turns out to be free. MultiPV is
 * ONE search however many lines it reports, and the search is bounded by
 * movetime rather than by depth, so breadth costs depth-per-line and nothing
 * else. Measured in this app's own worker, same position, same movetime:
 *
 *     MultiPV  5  ->   5 lines,  919ms, depth 12
 *     MultiPV 24  ->  24 lines,  921ms, depth 12
 *     MultiPV 40  ->  31 lines,  925ms, depth 12   (31 = every legal move)
 *     MultiPV 64  ->  38 lines,  922ms, depth 12   (a 38-move middlegame)
 *
 * Stockfish caps MultiPV at the legal move count, so asking for 64 asks for
 * "every move" without having to count them first. The top of the ranking is
 * stable across all of these widths, which is the thing that had to be checked
 * before widening it: the shortlist and the board's ramp come from the same
 * search.
 *
 * The alternative was to top up the stragglers with a second, restricted
 * search. That would have put two sets of numbers from two different searches
 * in one column — the measurement error `compare.ts` exists to avoid — in
 * exchange for nothing, since the wide search costs the same.
 */
const TABLE_PV = 64;
const TABLE_MOVETIME_MS = 900;

/**
 * How many of those lines are the engine's SHORTLIST.
 *
 * ---------------------------------------------------------------------------
 * Will: "now when I filter 'engine' it includes all moves, but we want the old
 * meaning of engine, which was 'the top 5 moves', so it actually filters
 * something."
 *
 * Asking for two dozen lines so every row could carry an evaluation also
 * tagged two dozen moves `engine`, so the chip selected the whole table. The
 * search stays wide — that is what fills the columns — and the TAG goes back
 * to what it always meant. Five, because that is what it was, and because the
 * ramp is scaled over five (see `candidateMoves`), so the shortlist and the
 * board's colour range now describe the same set.
 */
const ENGINE_PICKS = 5;

export type MoveTableData = {
	rows: MoveRow[];
	/** The engine's own ranking, for the board's colour ramp. */
	grades: Map<string, Candidate>;
	/** Theory here, by uci — so the board can mark a book move. */
	book: Set<string>;
	/** The explorer has answered, so an absent move means zero games. */
	askedPopularity: boolean;
	distribution: Distribution | null;
	/** A search is in flight. */
	working: boolean;
	error: string | null;
};

export function useMoveTable(
	fen: string | null,
	ourColour: 'w' | 'b' | undefined,
	/** Whether the table is on screen at all. Nothing is fetched when it is not. */
	shown: boolean,
	opts: { minFreq?: number } = {},
): MoveTableData {
	const [explorer, setExplorer] = useState<ExplorerResponse | null>(null);
	const [candidates, setCandidates] = useState<Candidate[] | null>(null);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/*
	 * CLEARING FIRST IS THE HALF THAT MATTERS.
	 *
	 * Without it the previous position's moves stay in the table, and drawn on
	 * the board, for as long as the new search takes — on a board where they are
	 * no longer legal. A blank table for a moment is honest; a wrong one is not.
	 *
	 * And this effect is the ONLY writer of both fields. Train learned that the
	 * hard way: a second place clearing them meant the effect saw no change, did
	 * not re-run, and left the board blank until a chip was toggled.
	 */
	useEffect(() => {
		setExplorer(null);
		setCandidates(null);
		setError(null);
		if (!shown || !fen) return;
		let live = true;
		void (async () => {
			try {
				const data = await fetchExplorer(fen);
				if (live) setExplorer(data);
			} catch (e) {
				if (live) setError((e as Error).message);
			}
		})();
		return () => {
			live = false;
		};
	}, [shown, fen]);

	useEffect(() => {
		setCandidates(null);
		if (!shown || !fen || !ourColour) return;
		let live = true;
		setWorking(true);
		void (async () => {
			try {
				const cands = await candidateMoves(
					fen,
					ourColour,
					TABLE_PV,
					TABLE_MOVETIME_MS,
				);
				if (live) setCandidates(cands);
			} catch (e) {
				if (live) setError((e as Error).message);
			} finally {
				if (live) setWorking(false);
			}
		})();
		return () => {
			live = false;
			setWorking(false);
		};
	}, [shown, fen, ourColour]);

	const distribution = useMemo(
		() => (explorer && fen ? distributionOf(explorer, colourOfFen(fen)) : null),
		[explorer, fen],
	);

	/** Theory here: what the explorer's own games say is a real opening move. */
	const theory = useMemo(
		() =>
			explorer
				? classifyBook(explorer, { minFreq: opts.minFreq })
						.filter(isTheory)
						.map((m) => ({ uci: m.uci, san: m.san }))
				: undefined,
		[explorer, opts.minFreq],
	);

	const rows = useMemo(
		() =>
			mergeMoves({
				// So the three sources cannot spell castling two different ways and
				// produce two rows for one move — see `MoveSources.fen`.
				fen: fen ?? undefined,
				line: theory,
				// The shortlist is what the chip selects; everything else the search
				// returned fills numbers without claiming to be a recommendation.
				engine: candidates ? candidates.slice(0, ENGINE_PICKS) : undefined,
				scores: candidates ?? undefined,
				// `undefined` until the explorer answers, an array afterwards — which
				// is what tells `mergeMoves` that a missing move means zero games
				// rather than an unasked question.
				popular: distribution?.moves,
			}),
		[fen, theory, candidates, distribution],
	);

	const grades = useMemo(
		() => new Map((candidates ?? []).map((c) => [c.uci, c])),
		[candidates],
	);

	const book = useMemo(() => new Set((theory ?? []).map((m) => m.uci)), [theory]);

	return {
		rows,
		grades,
		book,
		askedPopularity: explorer !== null,
		distribution,
		working,
		error,
	};
}
