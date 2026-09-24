// Whether the move table is up, and whether it stays up.
//
// ---------------------------------------------------------------------------
// Will: "let's make 'show moves' untoggle when move is made by default.
// Persistent toggled state can be gated behind double click?"
//
// The reason this is the right default is what the table COSTS. Having it open
// counts as help — `assisted` is set by the table being up, and a helped answer
// does not count towards retiring a card or towards the rating estimate. So a
// toggle that stays on silently marks every subsequent move as assisted, and
// the most likely way to leave it on is to have forgotten it is on. A control
// whose lingering state quietly invalidates your session should not linger by
// default.
//
// But it must still be possible to keep it up — reading a whole game with the
// numbers visible is a real thing to want, and pressing the button every ply
// would be its own punishment. Hence two facts rather than one.
//
// ---------------------------------------------------------------------------
// TWO FACTS, NOT A TRISTATE.
//
// `shown` and `pinned` could be folded into one `'off' | 'once' | 'pinned'`,
// and that reads well until the first caller asks "is the table up?" and has to
// know that two of the three values mean yes. `tableShown` already went through
// this once with `tableOn.size > 0` standing in for both "the table is showing"
// and "these filters are active", which made turning the last chip off look
// like a broken filter. Separate questions, separate fields.
// ---------------------------------------------------------------------------

export type TableToggle = {
	/** The table is on screen right now. */
	shown: boolean;
	/** …and survives the next move. */
	pinned: boolean;
};

export const TABLE_OFF: TableToggle = { shown: false, pinned: false };

/**
 * How long after a press a second one counts as a double.
 *
 * Longer than a mouse's own double-click threshold (typically 500ms but often
 * reported as much less) because this is also a double TAP, and a finger
 * travelling to a 52px target twice is slower than a mouse that never moved.
 */
export const DOUBLE_MS = 450;

/**
 * The button was pressed.
 *
 * A double press always means "keep it up", from either state: pressing twice
 * on a closed table opens and pins it, which is the gesture someone who knows
 * about it will use, and pressing twice on an open one pins what is already
 * there. Those are the same intention and it would be strange to distinguish.
 *
 * A single press on an open table closes it AND unpins. Unpinning separately
 * would need a third gesture nobody would find, and "off" is an unambiguous
 * place to start from.
 */
export function pressTable(cur: TableToggle, doubled: boolean): TableToggle {
	if (doubled) return { shown: true, pinned: true };
	return cur.shown ? TABLE_OFF : { shown: true, pinned: false };
}

/** What survives a move being played. */
export function afterMove(cur: TableToggle): TableToggle {
	return cur.pinned ? cur : TABLE_OFF;
}

/** What to say on the button, given where it is. */
export function tableTitle(cur: TableToggle): string {
	if (!cur.shown) return 'Show the moves — press twice to keep them up';
	return cur.pinned
		? 'Hide the moves (pinned — they stay up between moves)'
		: 'Hide the moves — press twice to keep them up';
}
