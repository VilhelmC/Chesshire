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

describe('a tab that shows a position', () => {
	const tabs: { file: string; src: string; moves: string; wheels: string; commentary: string; history: string }[] = [
		{
			file: 'src/views/Train.tsx',
			src: read('src/views/Train.tsx'),
			moves: 'region="train-moves"',
			wheels: '<TrainingWheels',
			commentary: 'region="train-commentary"',
			history: 'region="train-move-list"',
		},
		{
			file: 'src/views/Quiz.tsx',
			src: read('src/views/Quiz.tsx'),
			moves: 'region="quiz-moves"',
			wheels: '<TrainingWheels',
			commentary: 'region="quiz-commentary"',
			history: 'region="quiz-move-list"',
		},
	];

	for (const tab of tabs) {
		describe(tab.file, () => {
			it('analyses the position before recounting how you got here', () => {
				// Will: "I think the past move list (history) is not really important
				// — it should be after analytical content (but before options and
				// preferences)." Train had it first and Mistakes had it last.
				inOrder(tab.src, tab.file, [tab.moves, tab.history]);
			});

			it('leads the analysis with the move table', () => {
				inOrder(tab.src, tab.file, [tab.moves, tab.wheels, tab.commentary]);
			});

			it('keeps the training wheels above the history', () => {
				// The one Will named directly: "in Train training wheels are displayed
				// below past move list, in Mistakes above."
				inOrder(tab.src, tab.file, [tab.wheels, tab.history]);
			});

			it('says what just happened before analysing what is there now', () => {
				inOrder(tab.src, tab.file, ['{feedback && (', tab.moves]);
			});
		});
	}
});
