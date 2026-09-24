// The move table closes after a move unless you asked it not to.
//
// ---------------------------------------------------------------------------
// Will: "let's make 'show moves' untoggle when move is made by default.
// Persistent toggled state can be gated behind double click?"
//
// What makes the default the right one is what the table COSTS: having it open
// counts as help, so a toggle that lingers silently marks every later move as
// assisted — and the most likely way to leave it on is to have forgotten it is
// on. The pin exists because reading a whole game with the numbers up is a real
// thing to want. Both halves are pinned here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
	TABLE_OFF,
	afterMove,
	pressTable,
	tableTitle,
	type TableToggle,
} from '../src/domain/tableToggle';

const once: TableToggle = { shown: true, pinned: false };
const pinned: TableToggle = { shown: true, pinned: true };

describe('pressing the button', () => {
	it('opens it for this move', () => {
		expect(pressTable(TABLE_OFF, false)).toEqual(once);
	});

	it('closes it again, and unpins', () => {
		// Unpinning with its own gesture would need a third one nobody would find.
		// "Off" is an unambiguous place to start from.
		expect(pressTable(once, false)).toEqual(TABLE_OFF);
		expect(pressTable(pinned, false)).toEqual(TABLE_OFF);
	});

	it('pins on a double press, from either state', () => {
		// Opening-and-pinning and pinning-what-is-already-there are the same
		// intention, and it would be strange to distinguish them.
		expect(pressTable(TABLE_OFF, true)).toEqual(pinned);
		expect(pressTable(once, true)).toEqual(pinned);
		expect(pressTable(pinned, true)).toEqual(pinned);
	});
});

describe('playing a move', () => {
	it('puts an unpinned table away', () => {
		expect(afterMove(once)).toEqual(TABLE_OFF);
	});

	it('leaves a pinned one alone', () => {
		expect(afterMove(pinned)).toEqual(pinned);
	});

	it('does nothing to a closed one', () => {
		expect(afterMove(TABLE_OFF)).toEqual(TABLE_OFF);
	});
});

describe('what the button says', () => {
	it('advertises the double press wherever it would do something', () => {
		// A gesture nobody can find is not a feature. The tooltip is the only
		// place it can be discovered, so it has to be there in both states that
		// the gesture changes.
		expect(tableTitle(TABLE_OFF)).toMatch(/twice/i);
		expect(tableTitle(once)).toMatch(/twice/i);
	});

	it('says so when it is already pinned, rather than offering again', () => {
		expect(tableTitle(pinned)).toMatch(/pinned/i);
		expect(tableTitle(pinned)).not.toMatch(/twice/i);
	});
});
