// Everything under the board, in the order it goes in.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A COMPONENT AND NOT A CONVENTION.
//
// `BoardPanel`'s header writes the order down:
//
//   1. evaluation bar, board, captured material   <- BoardPanel
//   2. the control strip                          <- BoardPanel
//   3. what just happened
//   4. analysis of the position in front of you
//   5. history
//   6. options and preferences
//
// Steps 3 to 5 were then assembled by hand in Train and again in Mistakes, and
// they came out different three times running — the move table above the strip
// on one tab and below it on the other, the training wheels above the history
// here and below it there, and an explain panel with no bottom margin sitting
// flush against whatever followed it. Each was fixed by hand, in both files,
// and the next panel would have started the cycle again.
//
// A written-down convention plus a test that reads source order is the weakest
// form this rule can take: it catches a violation AFTER someone has written it,
// and it cannot catch a third view that nobody added to the test. Making the
// order structural means a caller cannot express the wrong one — the slots are
// named, and where they land is not the caller's business.
//
// ---------------------------------------------------------------------------
// AND WHY IT IS SLOTS RATHER THAN CHILDREN.
//
// `children` would put the order back in the caller's hands, which is the
// thing being taken away. Nine named slots is more surface than a layout
// component usually wants, and it is the honest amount: each one is a distinct
// thing with a distinct place, and the places are what kept drifting.
//
// This holds NO state and makes no decisions. It is the rhythm and the order,
// so that a tab showing a position — the trainer, the mistake deck, and
// whatever plays games against the engine next — gets both for free.
// ---------------------------------------------------------------------------

import { space } from '../ui/theme';

export function PositionStack({
	popover,
	verdict,
	moves,
	lines,
	wheels,
	commentary,
	explain,
	stats,
	history,
	footer,
}: {
	/**
	 * A panel belonging to a control in the strip, directly under it.
	 *
	 * The share menu. It sits FIRST because it is attached to a button a few
	 * pixels above it — rendered last, as it used to be, pressing a control at
	 * the top of the strip made a panel appear a screen further down, which on
	 * a phone is not visible at all.
	 */
	popover?: React.ReactNode;
	/** Step 3: the verdict on your move, their reply, how the run ended. */
	verdict?: React.ReactNode;
	/** Step 4, and first within it: the move table. */
	moves?: React.ReactNode;
	/** A line being walked on the board. */
	lines?: React.ReactNode;
	wheels?: React.ReactNode;
	commentary?: React.ReactNode;
	explain?: React.ReactNode;
	/**
	 * How the GAME has gone, as opposed to how the position stands.
	 *
	 * Between the analysis and the history because that is what it is — a record
	 * of what has already happened, one step more summarised than the move list
	 * beneath it. Will: "the statistics shown in review could be togglable since
	 * they really apply to any game?"
	 */
	stats?: React.ReactNode;
	/** Step 5. Last of the things about chess, because it is the least urgent. */
	history?: React.ReactNode;
	/** Anything that belongs after all of it: a status line, an error. */
	footer?: React.ReactNode;
}) {
	return (
		<div
			data-region="position-stack"
			/*
			 * ONE GAP, OWNED BY THE CONTAINER.
			 *
			 * Separation used to be every block's private business — some carried
			 * `marginTop: 8`, some 10, some none — so which pair ended up adjacent
			 * decided whether there was any space between them, and that changed
			 * whenever the order did. Will: "the explain move panel now intersects
			 * with the top of the move history." It had never been next to the
			 * history before, and it brings no margin of its own.
			 */
			style={{
				marginTop: space.card,
				display: 'flex',
				flexDirection: 'column',
				gap: space.card,
			}}
		>
			{popover}
			{verdict}
			{moves}
			{lines}
			{wheels}
			{commentary}
			{explain}
			{stats}
			{history}
			{footer}
		</div>
	);
}
