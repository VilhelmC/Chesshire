// Stepping back looks; it does not take back.
//
// ---------------------------------------------------------------------------
// Will: "I don't think it should function as a take back — it should just step
// back so user can review history by stepping through it. Game remains in
// current position and user can only play on from that position."
//
// What goes wrong with a cursor like this goes wrong at the ends: stepping
// forward off the last ply, stepping back from live, and a game with nothing in
// it yet. So the arithmetic is `domain/cursor` and this is where it is pinned —
// a pure test, like `walk.test.ts`, for the same reason: rendering a hook needs
// a DOM this project does not install, and the claim is not about React.
//
// `last` throughout is the index of the LIVE position. `replayLine` puts the
// starting position at 0 and each move after it, so a game of five moves has
// positions 0..5 and `last` is 5.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canStepBack, canStepForward, clampCursor, cursorIndex } from '../src/domain/cursor';

describe('where the cursor is', () => {
	it('treats live as the last position', () => {
		// The one conversion the rest of it is built on: null means "wherever the
		// game is", and the game is at the end.
		expect(cursorIndex(null, 5)).toBe(5);
		expect(cursorIndex(2, 5)).toBe(2);
	});
});

describe('where a step lands', () => {
	it('goes back into the game from live', () => {
		expect(clampCursor(cursorIndex(null, 5) - 1, 5)).toBe(4);
	});

	it('returns to live rather than stopping one short of it', () => {
		// The end of the list IS the live position. A forward control that refused
		// the final press would look broken for no reason a reader could see.
		expect(clampCursor(5, 5)).toBe(null);
		expect(clampCursor(4, 5)).toBe(4);
	});

	it('never lands past the end, however far it is pushed', () => {
		expect(clampCursor(99, 5)).toBe(null);
	});

	it('clamps at the start of the game', () => {
		expect(clampCursor(-1, 5)).toBe(0);
		expect(clampCursor(0, 5)).toBe(0);
	});

	it('has nowhere to go in a game with no moves', () => {
		// `last` 0 means the only position is the starting one, which is live.
		// Returning 0 here would leave the board "looking back" at the position it
		// is already on, with the controls disabled and no way out.
		expect(clampCursor(0, 0)).toBe(null);
		expect(clampCursor(-1, 0)).toBe(null);
	});
});

describe('which controls are live', () => {
	it('offers back whenever there is history behind the cursor', () => {
		expect(canStepBack(null, 5)).toBe(true);
		expect(canStepBack(1, 5)).toBe(true);
	});

	it('does not offer back at the start, or in an empty game', () => {
		expect(canStepBack(0, 5)).toBe(false);
		expect(canStepBack(null, 0)).toBe(false);
	});

	it('offers forward only when something has been stepped away from', () => {
		expect(canStepForward(null)).toBe(false);
		expect(canStepForward(0)).toBe(true);
		expect(canStepForward(4)).toBe(true);
	});
});

describe('who steps this way', () => {
	// A source check, like `pageOrder`'s: the claim is about which screens got
	// the looking-only stepper, and that claim is in `useStepBack`'s header.
	const read = (p: string) =>
		readFileSync(join(__dirname, '..', p), 'utf8');

	it('Play uses the hook rather than a cursor of its own', () => {
		const src = read('src/views/Play.tsx');
		expect(src).toContain('useStepBack(');
		expect(src, 'Play should not grow a second cursor').not.toContain('previewPly');
	});

	it('the trainer deliberately does not', () => {
		// It can resume from a ply it stepped to, which truncates the run — a real
		// take back, and the one thing the hook must not be able to express.
		expect(read('src/views/Train.tsx')).toContain('playFromPly');
	});
});
