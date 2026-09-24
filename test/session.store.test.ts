// A game in progress belongs to a screen, and each screen keeps its own.
//
// ---------------------------------------------------------------------------
// Will: "we've had an issue with play not persisting board state when switching
// between tabs or reloading app."
//
// The cause is structural and worth stating, because nothing about the Play tab
// looked wrong: `App` renders each tab as `{tab === 'x' && <X/>}`, so leaving a
// tab UNMOUNTS it and every `useState` in it goes. Train survived that by
// writing to `db.session` on each move and reading back on mount. Play wrote
// nothing — and the store held exactly one row, hardcoded to `'current'`, so
// there was nowhere for a second game to go even if it had tried.
//
// A SOURCE test, like `regions.test.ts` and `pageOrder.test.ts`, for the reason
// those are: exercising this for real needs IndexedDB, and this project
// installs no DOM or database test doubles. The claims being made are about
// which files do what, and reading them is exact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the store is keyed by screen', () => {
	const src = read('src/data/session.ts');

	it('takes a key rather than hardcoding one', () => {
		// `'current'` appeared three times as a literal. Every one of them was the
		// trainer claiming the only row there was.
		expect(src).toContain('key: SessionKey');
		expect(src).not.toContain("'current'");
	});

	it('still migrates rows written by older builds', () => {
		// A run saved before positions were classified has no `bookHere` and no
		// `opening`, and restoring it used to crash. The migration lives in the
		// loader rather than in a one-off pass, so it keeps working however old
		// the row is — and a key change is exactly the sort of edit that quietly
		// drops it.
		expect(src).toContain("if (!('bookHere' in st)) st.bookHere = [];");
		expect(src).toContain("if (!('opening' in st)) st.opening = null;");
	});

	it('names each screen after the screen', () => {
		// `'current'` was a name from when there was only one row, and it said
		// nothing about whose game it held. Will: "just use the 'train'
		// identifier, no one is using the app yet."
		expect(read('src/data/db.ts')).toContain("export type SessionKey = 'train' | 'play'");
		expect(read('src/views/Train.tsx')).toContain("saveSession('train'");
	});
});

describe('a screen that keeps a game', () => {
	// Both halves are needed and neither is enough. Saving without restoring
	// fills the database and shows a fresh board; restoring without saving finds
	// nothing there. Play had neither.
	const screens: [string, string][] = [
		['src/views/Train.tsx', 'train'],
		['src/views/Play.tsx', 'play'],
	];

	for (const [file, key] of screens) {
		it(`${file} writes its game`, () => {
			expect(read(file)).toContain(`saveSession('${key}'`);
		});

		it(`${file} reads it back on mount`, () => {
			expect(read(file)).toContain(`loadSession('${key}')`);
		});
	}
});

describe('the restore beats the new game', () => {
	const src = read('src/views/Play.tsx');

	it('waits for the read before starting a fresh game', () => {
		// The race that would make this half-work: "start a game if there is none"
		// fires on mount, and on a slow read it wins and overwrites the saved one
		// — which looks exactly like the board resetting, because it is.
		expect(src).toContain('const [restored, setRestored] = useState(false)');
		expect(src).toMatch(/if \(!restored\) return;\s*\n\s*if \(!state && !handoff\) void start/);
	});

	it('lets a handed-over position win', () => {
		// Arriving from Review or Mistakes with a position in hand is an explicit
		// request for THAT position, not for whatever was left on the board.
		expect(src).toMatch(/if \(handoff\) \{\s*\n\s*if \(live\) setRestored\(true\);/);
	});
});

describe('every tab that has a place keeps it', () => {
	// Will: "I also think the other tabs should persist state — for example
	// mistakes because currently it starts over same sequence every time user
	// leaves tab. review should also persist."
	//
	// One cause, four screens. `App` renders each tab as `{tab === 'x' && <X/>}`,
	// so leaving one unmounts it and every `useState` in it goes. What differs is
	// the SIZE of what has to survive, and therefore where it goes: a whole
	// `RunState` to `db.session`, an id or a ply to `viewState`.
	const src = (p: string) => read(p);

	it('Mistakes remembers which card was in front of you', () => {
		// Not which cards have been answered — `answer()` already pushes a correct
		// card's dueAt into the future, and a list of answered ids would grow with
		// nothing to clear it. See the note in `viewState`.
		expect(src('src/views/Quiz.tsx')).toContain("remember({ quizCurrentId:");
		expect(src('src/views/Quiz.tsx')).toContain("recall('quizCurrentId'");
		expect(src('src/data/viewState.ts')).not.toContain('quizDoneIds');
	});

	it('Review remembers the game and the ply', () => {
		expect(src('src/views/Review.tsx')).toContain("recall('reviewSelected'");
		expect(src('src/views/Review.tsx')).toContain("recall('reviewPly'");
	});

	it('Review does not reset the ply just for coming back', () => {
		// The trap: `useEffect(() => setPly(0), [selected])` fires on mount too,
		// because `selected` is restored there — undoing the restore one line
		// after doing it. It has to compare against the game it last ran for.
		expect(src('src/views/Review.tsx')).toContain('lastGame');
		expect(src('src/views/Review.tsx')).not.toContain('useEffect(() => setPly(0), [selected])');
	});
});
