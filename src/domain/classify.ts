// Thresholds and classification — see SPEC.md §4 and §8 (constants table).

import type { MoveClass } from './types';

export const COVERAGE_TARGET = 0.95; // stop enumerating opponent moves here
export const MIN_FREQ = 0.005; // ignore anything below 0.5%
export const MIN_GAMES = 200; // below this the node is too sparse to trust

// ---------------------------------------------------------------------------
// Blunder thresholds, revised 2026-08-18 after the first live run.
//
// A pure delta threshold of 150cp was wrong twice over:
//
//  * It missed Damiano's Defence (1.e4 e5 2.Nf3 f6), which goes +0.18 -> +1.62.
//    A 144cp delta — the most famous beginner blunder in the whole e5 complex,
//    filed as "nothing to punish" by six centipawns.
//  * Delta alone ignores where you END UP. What makes a drill worth learning is
//    that finding the right move leaves you clearly better, not that the
//    evaluation moved by some amount.
//
// So the test is now two-sided: the position after their move must be worth
// winning (ADVANTAGE), and their move must be what caused it (DELTA).
// ---------------------------------------------------------------------------
export const BLUNDER_ADVANTAGE = 120; // we must be this much better afterwards
export const BLUNDER_DELTA = 60; // and their move must have caused this much of it
export const INACCURACY_CP = 40;
export const REFUTES_US_CP = -50;

export const UNIQUE_MARGIN = 80; // solution must beat 2nd best by this
export const RESIST_MARGIN = 100; // opponent replies within this are plausible
export const WIN_THRESHOLD = 300; // drill ends once we reach this
export const MAX_PLIES = 4;
export const MAX_REPLIES = 2; // plausible opponent replies to branch on per node
/**
 * Time budget per node while walking the refutation tree. The tree needs
 * MultiPV, which the Lichess cloud does not store, so every node is a local
 * search — the cost is nodes x this, and it has to stay bounded.
 * Correctness is guarded by the deep verification pass, not by this search.
 */
export const TREE_MOVETIME_MS = 300;
export const MAX_NODES = 40; // above this, downgrade punish -> pressure

// Depth 22 was well past what blunder detection needs and cost seconds a node
// on the single-threaded WASM build. We are separating >=150cp errors, not
// splitting hairs — 18 finds those reliably.
export const D_SHALLOW = 12; // classification depth
export const D_DEEP = 18; // punishment-line depth
export const D_VERIFY = 24; // re-check depth for the soundness pass
/** Minimum cloud depth accepted as an independent verification. */
export const D_VERIFY_CLOUD = 30;
/** Local fallback budget when the cloud cannot verify. ~13x the tree budget. */
export const VERIFY_MOVETIME_MS = 4000;

/**
 * Classify an opponent move from the evaluations either side of it.
 * Both figures are centipawns from OUR point of view.
 */
export function classifyMove(
	evalBefore: number,
	evalAfter: number,
	isInRepertoire = false,
): MoveClass {
	if (isInRepertoire) return 'book';
	const delta = evalAfter - evalBefore;

	if (delta <= REFUTES_US_CP) return 'refutes_us';
	// Worth a punishment drill only if we end up clearly better AND their move
	// is what put us there.
	if (evalAfter >= BLUNDER_ADVANTAGE && delta >= BLUNDER_DELTA) return 'blunder';
	if (delta >= INACCURACY_CP) return 'inaccuracy';
	return 'playable';
}

/**
 * Truncate the opponent-move list to the moves worth preparing for.
 * Returns the kept moves and — importantly — the dropped ones, so the coverage
 * audit can report what we deliberately ignored. Silent truncation is the
 * failure mode that makes a trainer feel complete while leaving you exposed.
 */
export function truncateByCoverage<T extends { frequency: number }>(
	moves: T[],
): { kept: T[]; dropped: T[]; coveredMass: number } {
	const sorted = [...moves].sort((a, b) => b.frequency - a.frequency);
	const kept: T[] = [];
	const dropped: T[] = [];
	let mass = 0;

	for (const m of sorted) {
		if (mass >= COVERAGE_TARGET || m.frequency < MIN_FREQ) {
			dropped.push(m);
			continue;
		}
		kept.push(m);
		mass += m.frequency;
	}

	return { kept, dropped, coveredMass: mass };
}

/** Empirical score for the side to move, from explorer win/draw/loss counts. */
export function scoreForSideToMove(
	stm: 'w' | 'b',
	r: { white: number; draws: number; black: number },
): number {
	const total = r.white + r.draws + r.black;
	if (total === 0) return 0.5;
	const wins = stm === 'w' ? r.white : r.black;
	return (wins + r.draws / 2) / total;
}

// --- branching repertoire tree ---------------------------------------------
// A five-ply linear trunk only ever reached plies 1, 3 and 5, where nobody
// blunders — the first sweep found 4.1% of games worth drilling, almost all of
// it junk like 1.e4 g5. Real mistakes at this level happen around moves 5-8, so
// the tree has to go deeper and it has to branch.

/** How deep to grow the tree, in plies. */
export const TREE_MAX_PLIES = 12;
/** Opponent replies expanded per node, by frequency. Coverage, not drilling. */
export const TREE_EXPAND_TOP = 3;
/** Stop growing a branch once fewer than this share of games reach it. */
export const TREE_MIN_MASS = 0.005;
/** Hard cap on expanded nodes, so a wide opening cannot run away. */
export const TREE_MAX_NODES = 160;
/** Our candidate moves considered per node, by popularity. */
export const OUR_MOVE_CANDIDATES = 4;
/** Minimum popularity for one of our moves — keeps us in well-sampled lines. */
export const OUR_MOVE_MIN_FREQ = 0.03;
/**
 * Below this share of games a deviation is not worth an engine analysis.
 * 0.2% is about one game in five hundred.
 */
export const DRILL_MIN_MASS = 0.002;
