// One table for every move worth knowing about here.
//
// ---------------------------------------------------------------------------
// Will:
//
//   "I think the 'what other players actually play here' button is missing
//    Stockfish scores. Same for the 'Show' button (line moves). I think we
//    should unify these three buttons: one table, the buttons just toggle
//    different entries (may overlap), every move always has a Stockfish
//    evaluation, picked by other players frequency data for all moves, etc."
//
// Three buttons, three renderings, three shapes of row — and a move that was in
// two of them appeared twice, differently, with different columns filled in.
// "What do people play" had no evaluation; "show the line's moves" had neither
// evaluation nor frequency; only the engine list had a number, and it had no
// idea what anybody actually plays.
//
// THE MOVE IS THE ROW. It is in the line, or popular, or the engine likes it, or
// several of those at once — and those are TAGS on one row, not three tables.
// The buttons stop being three views and become a filter over one.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE WILL NOT DO: invent a number it does not have.
//
// Not every move can be given an evaluation cheaply. The engine ranks its own
// top few for one search; scoring an arbitrary extra move costs a search each
// (`compare.ts`), so a position with twelve popular replies is twelve searches.
// The host decides whether to spend that. Until it does, `cp` is null and the
// table says so — a blank cell, never a zero. A zero would read as "equal",
// which is a claim, and this has no basis for it.
// ---------------------------------------------------------------------------

import type { Candidate } from '../engine/candidates';
import type { MoveShare } from './distribution';

/** Where a move came from. A move can be in all three at once. */
export type MoveSource = 'line' | 'popular' | 'engine';

export type MoveRow = {
	uci: string;
	san: string;
	/** Which lists it appears in — the tags the filter buttons switch on. */
	sources: MoveSource[];
	/** Centipawns from the mover's point of view. Null when nobody has asked. */
	cp: number | null;
	/** Gap to the best move here, in centipawns. Null when `cp` is. */
	loss: number | null;
	/** Mate distance, positive for the mover. */
	mate: number | null;
	/** Games in the explorer, and the share of them. Null when not looked up. */
	games: number | null;
	share: number | null;
	/** Expected score for the mover, 0–1. Not a win rate — draws are in it. */
	score: number | null;
};

export type MoveSources = {
	/** The moves the opening line allows here. */
	line?: { uci: string; san: string }[];
	/** What the engine ranks, mover's point of view. */
	engine?: Candidate[];
	/** What people actually play, from the explorer. */
	popular?: MoveShare[];
};

/**
 * Merge the three lists into one row per move.
 *
 * Order: the engine's ranking when it has one, then the rest by popularity, then
 * whatever is left. That is the order a reader wants — best first — while still
 * showing a move nobody has evaluated rather than hiding it at the bottom of a
 * list sorted on a field it does not have.
 */
export function mergeMoves(sources: MoveSources): MoveRow[] {
	const rows = new Map<string, MoveRow>();

	const touch = (uci: string, san: string, source: MoveSource): MoveRow => {
		let row = rows.get(uci);
		if (!row) {
			row = { uci, san, sources: [], cp: null, loss: null, mate: null, games: null, share: null, score: null };
			rows.set(uci, row);
		}
		// A move can genuinely be in every list; the tags are a set, not a choice.
		if (!row.sources.includes(source)) row.sources.push(source);
		// SAN from whichever source has it. They agree, being the same position —
		// but the line's list is hand-built and the explorer's comes over the wire,
		// so preferring a non-empty one is cheaper than trusting both.
		if (!row.san && san) row.san = san;
		return row;
	};

	for (const m of sources.line ?? []) touch(m.uci, m.san, 'line');

	for (const c of sources.engine ?? []) {
		const row = touch(c.uci, c.san, 'engine');
		row.cp = c.cp;
		row.loss = c.loss;
	}

	for (const p of sources.popular ?? []) {
		const row = touch(p.uci, p.san, 'popular');
		row.games = p.games;
		row.share = p.share;
		row.score = p.score;
	}

	const out = [...rows.values()];
	out.sort((a, b) => {
		// Evaluated moves first, best first. `cp` is mover-relative, so higher wins.
		if (a.cp !== null && b.cp !== null) return b.cp - a.cp;
		if (a.cp !== null) return -1;
		if (b.cp !== null) return 1;
		// Then by how often people play it.
		if (a.games !== null && b.games !== null) return b.games - a.games;
		if (a.games !== null) return -1;
		if (b.games !== null) return 1;
		return a.san.localeCompare(b.san);
	});
	return out;
}

/**
 * Fill in evaluations the host has since paid for.
 *
 * Separate from the merge because it happens LATER: the explorer answers in a
 * round trip and the engine takes a search per move, so a table that waited for
 * everything would show nothing for seconds. Rows arrive unevaluated and are
 * filled in.
 */
export function withScores(rows: MoveRow[], scored: { uci: string; cp: number; loss: number; mate?: number | null }[]): MoveRow[] {
	const by = new Map(scored.map((s) => [s.uci, s]));
	return rows.map((r) => {
		const s = by.get(r.uci);
		return s ? { ...r, cp: s.cp, loss: s.loss, mate: s.mate ?? null } : r;
	});
}

/** The rows a set of active filters admits. Empty set means everything. */
export function filterMoves(rows: MoveRow[], on: ReadonlySet<MoveSource>): MoveRow[] {
	if (!on.size) return rows;
	return rows.filter((r) => r.sources.some((s) => on.has(s)));
}

/**
 * The gap to the best move — or the reason there isn't one.
 *
 * MATE IS FOLDED INTO THE ±10000 BAND so it outranks any evaluation on a single
 * number. Right for ORDERING, meaningless as a DIFFERENCE: subtracting −107 from
 * +10000 gives "−100.97", which is not a hundred pawns and is not anything.
 *
 * `explain.ts` already refuses this — its `comparable` flag exists for the case,
 * and `m3-gate.mjs` caught the same sentence on its first run. The Lab's engine
 * table reintroduced it anyway, which is why the rule now lives beside the
 * shared component rather than inside one caller: A CENTIPAWN GAP IS ONLY A
 * NUMBER WHEN BOTH SIDES OF THE SUBTRACTION ARE CENTIPAWNS.
 */
export function lossText(row: MoveRow, best: MoveRow | undefined): string {
	if (row.cp === null) return '';
	if (!best || best.cp === null || row.uci === best.uci) return '—';
	const isMate = (c: number) => Math.abs(c) >= 9000;
	if (isMate(best.cp) && !isMate(row.cp)) return 'no mate';
	if (isMate(best.cp) && isMate(row.cp)) return row.cp === best.cp ? '—' : 'slower';
	if (isMate(row.cp)) return '—';
	// THE TWO PRODUCERS DISAGREE ON THE SIGN. `candidates.ts` computes
	// `best - cp`, so a worse move has a POSITIVE loss; `compare.ts` computes
	// `cp - top`, so the same move has a NEGATIVE one. Both mean "behind by this
	// much", and a display that assumes either convention renders "−-1.00" for
	// the other. The magnitude is the number; the minus sign is the label.
	return row.loss ? `−${(Math.abs(row.loss) / 100).toFixed(2)}` : '—';
}

/** An evaluation as something a person can read. */
export function evalText(row: MoveRow): string {
	if (row.cp === null) return '…';
	if (Math.abs(row.cp) >= 9000) return row.cp > 0 ? 'mate' : 'mated';
	return `${row.cp > 0 ? '+' : ''}${(row.cp / 100).toFixed(2)}`;
}
