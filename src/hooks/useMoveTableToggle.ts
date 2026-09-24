// The move table's button, for every tab that has one.
//
// ---------------------------------------------------------------------------
// Train, Mistakes and Play each held a `tableShown` boolean, each with its own
// setter that wrote the same `viewState` key, and all three were about to need
// the same two new behaviours — closing after a move, and a double press that
// pins. Three copies of six lines is survivable; three copies about to become
// three copies of twenty is the point to stop.
//
// The DECISIONS are in `domain/tableToggle`, which is pure and tested. What is
// here is the two things a hook is actually for: remembering the answer across
// reloads, and the double-press timing, which needs a clock.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from 'react';
import {
	DOUBLE_MS,
	TABLE_OFF,
	afterMove,
	pressTable,
	tableTitle,
	type TableToggle,
} from '../domain/tableToggle';
import { recall, remember } from '../data/viewState';

export type MoveTableToggle = TableToggle & {
	/** The button was pressed. Works out for itself whether it was a double. */
	press: () => void;
	/** A move was played: closes unless pinned. */
	played: () => void;
	/** Put it away, whatever it was — for a new run, or a finished one. */
	close: () => void;
	title: string;
};

export function useMoveTableToggle(): MoveTableToggle {
	const [state, setState] = useState<TableToggle>(() => ({
		/*
		 * PINNED IS WHAT PERSISTS, and `shown` follows it.
		 *
		 * Restoring `shown: true` without `pinned` would put the table up on a
		 * reload having just decided it should not survive a MOVE, which is the
		 * shorter interval of the two. The stored `tableShown` key is still read
		 * so that a browser that pinned it under the old build — where staying up
		 * was the only behaviour — comes back pinned rather than blank.
		 */
		shown: recall('tablePinned', (v) => typeof v === 'boolean') === true,
		pinned: recall('tablePinned', (v) => typeof v === 'boolean') === true,
	}));
	const lastPress = useRef(0);

	const write = useCallback((next: TableToggle) => {
		setState(next);
		remember({ tableShown: next.shown, tablePinned: next.pinned });
	}, []);

	const press = useCallback(() => {
		const now = Date.now();
		const doubled = now - lastPress.current < DOUBLE_MS;
		lastPress.current = now;
		setState((cur) => {
			const next = pressTable(cur, doubled);
			remember({ tableShown: next.shown, tablePinned: next.pinned });
			return next;
		});
	}, []);

	const played = useCallback(() => {
		setState((cur) => {
			const next = afterMove(cur);
			if (next !== cur) remember({ tableShown: next.shown, tablePinned: next.pinned });
			return next;
		});
	}, []);

	const close = useCallback(() => write(TABLE_OFF), [write]);

	return { ...state, press, played, close, title: tableTitle(state) };
}
