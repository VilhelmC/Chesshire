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
import { costs, forks, mates } from './primitives';
import { pins } from './primitives/pin';
import { deficiencies } from './primitives/muster';

export type Wheel = 'safe' | 'mate' | 'forks' | 'pins' | 'deficient';

export const WHEELS: {
	key: Wheel;
	label: string;
	note: string;
	needsFocus?: boolean;
}[] = [
	{
		key: 'safe',
		label: 'safe moves',
		note: 'click a man: where it can go without dropping material',
		needsFocus: true,
	},
	{ key: 'mate', label: 'mate in one', note: 'moves that end it now' },
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

	if (on.has('mate')) for (const m of mates(pos)) out.push({ orig: sq(m.from), dest: sq(m.to), brush: 'blue' });

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
	if (on.has('mate')) for (const m of mates(pos)) out.push(`${sq(m.to)} is mate`);
	if (on.has('forks'))
		for (const f of forks(pos)) out.push(`${sq(f.move.to)} forks ${f.targets.map(sq).join(' and ')}`);
	if (on.has('pins'))
		for (const p of pins(pos)) out.push(`${sq(p.shield)} is pinned to the king by ${sq(p.pinner)}`);
	if (on.has('deficient'))
		for (const d of deficiencies(pos)) out.push(`${sq(d.square)} cannot be won — they can always answer`);
	return out;
}
