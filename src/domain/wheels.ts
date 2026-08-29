// TRAINING WHEELS — the gated overlays, turned into shapes.
//
// ---------------------------------------------------------------------------
// `PLAN-EXPLAINER.md` §5's second half: "a training-wheels menu — checkboxes for
// the §4 overlays, drawn on the board through the existing `Shape[]` API,
// independent of whether an explanation is open."
//
// FIVE OF THE EIGHT THINGS THAT WERE BUILT ARE HERE. The other three — the
// relative pin, the skewer and overload — failed their gates and are deleted, so
// they cannot appear in this menu even by accident. That is the point of putting
// the list in one place: a menu is where an ungated feature gets in, because a
// checkbox looks like it costs nothing.
//
//   safe moves     referee, 0% false safe by construction   FINDING-THE-REFEREE-WON
//   mate           exact, 0 missed of 54 mateIn1 finals
//   forks          LIFT +50.5%, decoration 2.4%
//   pins           LIFT +43.6%, decoration 1.4%             FINDING-TWO-THIRDS-OF-A-PIN
//   deficiency     0.87% falsified, fires on 9.9% of plies  FINDING-A-GATE-THAT-PASSES
//
// ---------------------------------------------------------------------------
// WHY `safe` NEEDS A FOCUSED PIECE AND THE OTHERS DO NOT.
//
// The safe-move overlay is the one that would drown the board. A position has 27
// legal moves on average and about a third are safe, so drawing them all is nine
// arrows fanning out of six different men — technically the answer to the
// question and useless as a picture.
//
// So it draws for ONE man, the one the reader has clicked. That is not a
// compromise forced by rendering: "which of THIS piece's moves are safe" is the
// question a learner actually has, and the all-at-once version was never it. The
// other four are naturally sparse — a handful of squares each — and are drawn
// whole.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Square } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import type { Shape } from '../components/Board';
import { moves } from './primitives/core';
import { costs, forks } from './primitives';
import { pins } from './primitives/pin';
import { deficiencies } from './primitives/muster';
import { allMoves, mateGoal, mateTree, principalLine } from './ladder';
import { solve } from './pns';
import type { NormalMove } from 'chessops/types';

export type Wheel = 'safe' | 'mate' | 'forks' | 'pins' | 'deficient';

export const WHEELS: {
	key: Wheel;
	label: string;
	note: string;
	needsFocus?: boolean;
	/** Needs a search, so the host runs it off the render path. See `mateLine`. */
	slow?: boolean;
}[] = [
	{
		key: 'safe',
		label: 'safe moves',
		note: 'click a man: where it can go without dropping material',
		needsFocus: true,
	},
	{ key: 'mate', label: 'mate', note: 'the forced mate, move by move', slow: true },
	{
		key: 'forks',
		label: 'forks',
		note: 'one man attacking two they cannot both save',
	},
	{ key: 'pins', label: 'pins', note: 'men that cannot legally move' },
	{
		key: 'deficient',
		label: 'not worth attacking',
		note: 'squares you cannot win however many men you send',
	},
];

const sq = (s: Square) => makeSquare(s);

/**
 * The shapes for whichever wheels are on.
 *
 * Pure, and deliberately so: the caller memoises on the FEN. Nothing here
 * touches an engine, which is what makes the menu instant — every one of these
 * is a board computation, and the most expensive is a few milliseconds.
 */
export function wheelShapes(pos: Chess, on: ReadonlySet<Wheel>, focus?: Square | null): Shape[] {
	const out: Shape[] = [];

	// SAFE — for the focused man only. See the header.
	if (on.has('safe') && focus !== undefined && focus !== null && pos.board[pos.turn].has(focus)) {
		for (const m of moves(pos)) {
			if (m.from !== focus) continue;
			// Green for holds, red for drops. Both are drawn: "these are safe" is
			// half a lesson, and the man who has nowhere safe to go should look
			// alarming rather than blank.
			out.push({ orig: sq(m.from), dest: sq(m.to), brush: costs(pos, m) === 0 ? 'green' : 'red' });
		}
	}

	if (on.has('forks'))
		for (const f of forks(pos)) {
			out.push({ orig: sq(f.move.from), dest: sq(f.move.to), brush: 'yellow' });
			// Rings on the men that are hit. A shape with no `dest` is a circle.
			for (const t of f.targets) out.push({ orig: sq(t), brush: 'yellow' });
		}

	if (on.has('pins'))
		for (const p of pins(pos)) {
			// The arrow runs pinner → king, which passes over the shield, and the
			// ring goes on the shield because that is the man the sentence is about.
			out.push({ orig: sq(p.pinner), dest: sq(p.king), brush: 'red' });
			out.push({ orig: sq(p.shield), brush: 'red' });
		}

	// DEFICIENCY — the only overlay that says DON'T. Circles, no arrows: there is
	// no move to draw, which is the whole content of the claim.
	if (on.has('deficient')) for (const d of deficiencies(pos)) out.push({ orig: sq(d.square), brush: 'blue' });

	return out;
}

/**
 * One line per wheel that has something to say, for a caption under the board.
 *
 * Fixed text from the primitives' own marks, never generated. The overlay draws
 * the geometry; this says what it is called, because a ring the reader cannot
 * name has taught them a shape rather than an idea.
 */
export function wheelNotes(pos: Chess, on: ReadonlySet<Wheel>): string[] {
	const out: string[] = [];
	if (on.has('forks'))
		for (const f of forks(pos)) out.push(`${sq(f.move.to)} forks ${f.targets.map(sq).join(' and ')}`);
	if (on.has('pins'))
		for (const p of pins(pos)) out.push(`${sq(p.shield)} is pinned to the king by ${sq(p.pinner)}`);
	if (on.has('deficient'))
		for (const d of deficiencies(pos)) out.push(`${sq(d.square)} cannot be won — they can always answer`);
	return out;
}

// ---------------------------------------------------------------------------
// MATE IS THE ONE WHEEL THAT IS NOT A BOARD COMPUTATION.
//
// The first version drew mate in ONE — `mates(pos)`, an `isCheckmate()` test per
// move, microseconds, and exactly as instant as the rest of the menu. Will's
// reaction was that this is the wrong overlay: a learner wants to see the mate
// SEQUENCE, numbered, not the single move that happens to end it.
//
// That is a df-pn search, and `scripts/mate-line-cost.mjs` priced it before any
// of this was written. Three versions, at depth 5, over 730 solver plies:
//
//   straight to depth 5      mean  79.1ms  p90 199ms  max 1038ms  — WRONG (below)
//   deepening, no probe      mean 140.6ms  p90 335ms  max 1258ms
//   SHIPPED: probe + deepen  mean  88.3ms  p90 221ms  max 1055ms
//                            over one frame 77.5%  over 100ms 23.4%  over 500ms 2.2%
//
// Correctness costs 12% over the fast-and-wrong version, and the probe pays for
// most of the deepening back.
//
// A second of frozen UI on a checkbox is not acceptable, so this does NOT run in
// `wheelShapes` and the host runs it off the render path with a working state.
// The rest of the menu stays synchronous and instant; mate is the exception and
// is flagged `slow` in `WHEELS` so a host cannot forget.
//
// It is also not a decoration: a forced mate exists on 24.4% of solver plies in
// a puzzle corpus, which is a set selected for having tactics. On a real game it
// will be rarer still.
// ---------------------------------------------------------------------------

/**
 * One line of the forced mate, or null if there is none within `depth`.
 *
 * ONE LINE, and the caption must say so. `mateTree`'s certificate answers EVERY
 * reply — that is what makes it a proof — and eight arrows on a board is a
 * picture where a whole tree is a scribble. The proof tab shows the tree; this
 * shows the line a defender would actually choose (`principalLine` takes the
 * longest resistance at each of their turns), and neither pretends to be the
 * other.
 *
 * Depth 5 is the measured horizon: it covers 98.20% of all 1,937,001 mate
 * puzzles in the Lichess corpus (`FINDING-THE-MATE-HORIZON.md`).
 */
export function mateLine(pos: Chess, depth = 5): NormalMove[] | null {
	const attacker = pos.turn;
	const goal = mateGoal(attacker, { narrow: true, seed: true });
	// ONE FULL-DEPTH PASS FIRST, TO LEARN WHETHER THERE IS A MATE AT ALL.
	//
	// A forced mate exists on 24.4% of solver plies, so three quarters of the time
	// the deepening below would run all five passes and find nothing. Asking the
	// cheap question first — is there one? — costs those positions a single pass
	// instead. Measured: 79.3ms mean for this pass against 141.8ms for deepening
	// unconditionally (`scripts/mate-line-cost.mjs`).
	//
	// It does NOT tell us which move or how long, and deliberately: that is the
	// next block's job and mixing them is how the bug below happened.
	let any = false;
	for (const m of allMoves(pos)) {
		const child = pos.clone();
		child.play(m);
		if (solve(goal, child, depth - 1).refuted) {
			any = true;
			break;
		}
	}
	if (!any) return null;

	// ITERATIVE DEEPENING, AND IT IS ABOUT CORRECTNESS RATHER THAN SPEED.
	//
	// The first version searched straight to `depth` and returned the first move
	// that proved a mate. On `7k/R7/1R6/8/8/8/8/6K1 w` that is Kf1, giving
	// "Kf1 Kg8 Rf6 Kh8 Rf8#" — a real forced mate, five plies long, offered to a
	// reader while Rb8# sits on the board. Every claim in it is true and the
	// overlay is still lying, because "the forced mate" and "a forced mate" are
	// not the same sentence.
	//
	// Move ordering decided which one was found, which is exactly the kind of
	// thing that must not be load-bearing. Asking for depth 1 first, then 2, makes
	// the SHORTEST mate the one that is returned — a property of the question
	// rather than of the move list's order.
	for (let d = 1; d <= depth; d++) {
		for (const m of allMoves(pos)) {
			const child = pos.clone();
			child.play(m);
			if (!solve(goal, child, d - 1).refuted) continue;
			return principalLine(mateTree(pos, m, attacker, d));
		}
	}
	return null;
}

/**
 * The mate line as numbered arrows.
 *
 * NUMBERED, because a mate is a SEQUENCE and eight unlabelled arrows are a
 * tangle the reader has to re-derive the order of. Ours and theirs get different
 * brushes as well as different numbers, since "whose move is this" is the first
 * question asked of any arrow on a board.
 */
export function mateArrows(line: NormalMove[]): Shape[] {
	return line.map((m, i) => ({
		orig: sq(m.from),
		dest: sq(m.to),
		// Ours on even plies — the line always starts with the side to move.
		brush: i % 2 === 0 ? 'blue' : 'red',
		label: String(i + 1),
	}));
}

/** The caption for a mate line. Fixed text; the count is the only variable. */
export function mateNote(line: NormalMove[]): string {
	const ours = Math.ceil(line.length / 2);
	// "One line" is load-bearing: the proof answers every reply and this does not.
	return `mate in ${ours} — one line of it; the proof tab answers every reply`;
}
