// Every tab that shows a position puts the same things in the same order.
//
// ---------------------------------------------------------------------------
// Will: "we are being inconsistent about component ordering / page layout. For
// example: on Train 'show moves' table is displayed beneath buttons array and
// session statistics. In Mistakes tab the 'show moves' table is displayed above
// the buttons array and the past move list. In Train training wheels are
// displayed below past move list, in Mistakes above."
//
// Three different orderings on two screens, each arrived at by whoever last
// added a panel putting it wherever there was room. The order is written down
// in `BoardPanel`'s header now, and this is what makes that comment binding:
//
//   1. evaluation bar, board, captured material
//   2. the control strip
//   3. what just happened
//   4. analysis of the position in front of you
//   5. history
//   6. options and preferences
//
// A SOURCE test, like `regions.test.ts` and for the same reason: rendering
// either view needs an engine, a token and a deck, and none of that is what is
// being asserted. The claim is about the order the JSX is written in, which is
// the order it renders in, and reading it is exact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * Where a marker sits in a file, by character offset.
 *
 * Fails loudly rather than returning -1: a marker that has been renamed is a
 * test that has stopped checking anything, and silently passing is the worst
 * outcome available.
 */
function at(src: string, marker: string, file: string): number {
	const i = src.indexOf(marker);
	expect(i, `${file} no longer contains ${JSON.stringify(marker)}`).toBeGreaterThan(-1);
	return i;
}

/** Assert markers appear in this order, naming the pair that is out of place. */
function inOrder(src: string, file: string, markers: string[]): void {
	const found = markers.map((m) => [m, at(src, m, file)] as const);
	for (let i = 1; i < found.length; i++) {
		const [prevName, prev] = found[i - 1];
		const [name, here] = found[i];
		expect(
			here,
			`${file}: ${JSON.stringify(name)} should come after ${JSON.stringify(prevName)}`,
		).toBeGreaterThan(prev);
	}
}

describe('the board panel', () => {
	const src = read('src/components/BoardPanel.tsx');

	it('puts the control strip next to the board, before anything the view adds', () => {
		// The strip used to render after `children`, so everything a view had to
		// say stood between the board and the buttons that act on it — and how far
		// between depended on how much that view happened to have, which is where
		// the two tabs diverged.
		inOrder(src, 'BoardPanel.tsx', ['<MaterialBar', '<Toolbar', '{children}']);
	});
});

describe('the stack that holds everything under the board', () => {
	const src = read('src/components/PositionStack.tsx');

	it('renders its slots in the one order', () => {
		// The order is structural now rather than conventional: a caller names a
		// slot and cannot say where it goes. This asserts the slots come out in
		// the documented sequence — what just happened, then the analysis of the
		// position in front of you, then the history.
		inOrder(src, 'PositionStack.tsx', [
			'{popover}',
			'{verdict}',
			'{moves}',
			'{lines}',
			'{wheels}',
			'{commentary}',
			'{explain}',
			'{stats}',
			'{controls}',
			'{history}',
			'{footer}',
		]);
	});
});

describe('the board panel says where you are first', () => {
	const src = read('src/components/BoardPanel.tsx');

	it('renders the caption above the board', () => {
		// Step 0 of the order. It is above the evaluation bar and the board
		// because it is context FOR the position — Train used to write it by
		// hand here and the other three boards wrote nothing.
		inOrder(src, 'BoardPanel.tsx', ['<PositionCaption', '<EvalBar', '<Board', '<Toolbar']);
	});
});

describe('every board in the app says which line it is in', () => {
	// Will: "perhaps that message should be part of the standard machinery
	// everything consumes, so a board is always displayed with the line it
	// belongs to if such a line exists."
	//
	// Review is in this list and does NOT go through `BoardPanel`, so it is
	// checked for the component directly. That is the remaining divergence: it
	// is the fourth board and the only one outside the shared geometry.
	const boards: [string, string][] = [
		['src/views/Train.tsx', 'caption={'],
		['src/views/Quiz.tsx', 'caption={'],
		['src/views/Play.tsx', 'caption={'],
		['src/views/Review.tsx', '<PositionCaption'],
	];

	for (const [file, marker] of boards) {
		it(`${file} supplies one`, () => {
			expect(read(file), `${file} should contain ${JSON.stringify(marker)}`).toContain(marker);
		});
	}

	it('and none of them spells the line out by hand', () => {
		// Not "must not call `whereYouAre`" — calling it is the point, and
		// Mistakes does, for the rows in its deck list. The thing to keep out is
		// a SECOND FORMAT: Quiz built `${line}, move ${no}` itself and so did the
		// paragraph above Train's board, which is how the same card ended up
		// described twice on one screen with two chances to disagree.
		for (const [file] of boards) {
			expect(read(file), `${file} should not build the line's wording itself`).not.toMatch(
				/, move \$\{/,
			);
		}
	});
});

describe('the scoring panel is for games, not drills', () => {
	// Will: "the statistics shown in review could be togglable since they really
	// apply to any game?" — and "any game" is the operative word.
	//
	// Train and Mistakes are DRILLS. Their centipawn losses measure recall of a
	// line you are trying to memorise, and averaging them into an accuracy would
	// answer "how well do you remember the Italian" with a number that reads as
	// "how well do you play chess". The app is careful about that difference
	// everywhere else — `storedPhase` exists so that only free play feeds the
	// rating estimate — and a panel is an easy place to lose it again.
	for (const file of ['src/views/Play.tsx', 'src/views/Review.tsx']) {
		it(`${file} shows it`, () => {
			expect(read(file)).toContain('<GameStats');
		});
	}
	for (const file of ['src/views/Train.tsx', 'src/views/Quiz.tsx']) {
		it(`${file} does not`, () => {
			expect(read(file), `${file} is a drill — see components/GameStats`).not.toContain(
				'<GameStats',
			);
		});
	}
});

describe('a tab that shows a position', () => {
	const tabs = [
		{ file: 'src/views/Train.tsx', src: read('src/views/Train.tsx') },
		{ file: 'src/views/Quiz.tsx', src: read('src/views/Quiz.tsx') },
	];

	for (const tab of tabs) {
		describe(tab.file, () => {
			it('hands its blocks to the shared stack rather than ordering them', () => {
				// The check that actually holds the line. Reading source order in each
				// view caught a violation AFTER someone wrote it, and could not catch
				// a third view nobody had added to the list. A view that goes through
				// `PositionStack` cannot express a wrong order at all.
				expect(tab.src, `${tab.file} should render <PositionStack>`).toContain(
					'<PositionStack',
				);
			});

			it('names the slots rather than passing children', () => {
				// `children` would put the order back in the caller's hands, which is
				// the thing being taken away.
				for (const slot of ['verdict=', 'moves=', 'history=']) {
					expect(tab.src, `${tab.file} should fill ${slot}`).toContain(slot);
				}
			});
		});
	}
});
