// The guard that would have caught the drift.
//
// ---------------------------------------------------------------------------
// PLAN.md rules 1 and 2.
//
// `ledger.ts` and `cover.ts` cited DEFICIENCY.md §3.3 in their comments while
// implementing a two-ply replay search. Nothing noticed, because a comment
// saying "§3.3" is not a test. Will: "I will not have more of this implementing
// a thing completely different from what we agreed."
//
// So this is mechanical. A module in the graph-and-ledger layer answers
// questions from an INDEX; if it plays a move, clones a position or builds one
// from a FEN, it has stopped reading the state and started exploring it, and
// that is the exact shape of the mistake. The build fails rather than the error
// surviving until someone reads the output and sees it is wrong.
//
// Modelled on `browser-safe.test.ts`, which already earns its keep in this repo
// for the same reason — and, like it, verified by deliberately reintroducing the
// thing it forbids and watching it fail. A guard nobody has seen fail is a guard
// nobody has tested.
//
// This is not a ban on search everywhere. Views, harnesses and the frozen
// baseline all legitimately play moves. It is a ban in the layer whose whole
// claim is that it does not need to.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The modules that must answer from the index alone.
 *
 * `ledger.ts` and `cover.ts` are the frozen baseline (PLAN.md) and are
 * deliberately ABSENT — they fail this test, which is the finding that produced
 * it. `ledger2.ts` is M3's rewrite and `cover2.ts` is M4's; both are on the list.
 * The frozen `ledger.ts` / `cover.ts` pair is deliberately NOT — they are the
 * measured baseline and are deleted at M7, and guarding a module you intend to
 * delete for behaviour you already know it has is theatre.
 *
 * M4's done-when is exactly this file passing on `cover2.ts`: the covering
 * condition must be read off the index, never by playing a move and looking.
 */
const GUARDED = ['graph.ts', 'reach.ts', 'paths.ts', 'ledger2.ts', 'cover2.ts', 'couple.ts', 'concede2.ts', 'complex.ts', 'gamma.ts', 'traverse.ts'];

/** Constructs or mutates a position rather than reading an index. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
	{ pattern: /\.play\s*\(/, why: 'plays a move — the state should already say what a move does' },
	// NOT a bare `.clone()`. Amended when it caught `paths.ts`, which clones a
	// BOARD to construct a hypothetical occupancy — an empty-board walk, which is
	// exactly what a geometric question needs. A Board has no turn, no legality
	// and no move generation, so you cannot explore with one. What marks
	// exploration is cloning a POSITION and playing on it, which the patterns
	// below catch directly. Blunter is not safer here: a rule that fires on
	// legitimate code gets an exception list, and an exception list is how a
	// guard stops guarding.
	{ pattern: /\bChess\b[\s\S]{0,20}\.clone\s*\(\)/, why: 'clones a position' },
	{ pattern: /\bnew Chess\b/, why: 'constructs a position' },
	{ pattern: /positionFromFen\s*\(/, why: 'builds a position from a FEN' },
	{ pattern: /\ballDests\s*\(/, why: 'generates moves — candidates come from the index by reverse lookup' },
];

/**
 * Comments are allowed to discuss what the code must not do, and these files
 * discuss it at length. Stripping them first is what keeps the guard from
 * failing on its own explanation.
 */
function code(text: string): { line: number; text: string }[] {
	const out: { line: number; text: string }[] = [];
	let inBlock = false;
	text.split('\n').forEach((raw, i) => {
		let line = raw;
		if (inBlock) {
			const end = line.indexOf('*/');
			if (end === -1) return;
			line = line.slice(end + 2);
			inBlock = false;
		}
		for (;;) {
			const start = line.indexOf('/*');
			if (start === -1) break;
			const end = line.indexOf('*/', start + 2);
			if (end === -1) {
				line = line.slice(0, start);
				inBlock = true;
				break;
			}
			line = line.slice(0, start) + line.slice(end + 2);
		}
		const slash = line.indexOf('//');
		if (slash !== -1) line = line.slice(0, slash);
		if (line.trim()) out.push({ line: i + 1, text: line });
	});
	return out;
}

const dir = join(process.cwd(), 'src/domain');
const present = GUARDED.filter((f) => existsSync(join(dir, f)));

describe('the graph layer answers from the index, not by exploring', () => {
	// A guard over an empty set is a guard that always passes. If every guarded
	// module has been renamed away, that is a fact worth failing on.
	it('has something to guard', () => {
		expect(present.length).toBeGreaterThan(0);
	});

	for (const file of present) {
		it(`${file} constructs no positions and plays no moves`, () => {
			const lines = code(readFileSync(join(dir, file), 'utf8'));
			const hits: string[] = [];
			for (const { line, text } of lines) {
				for (const { pattern, why } of FORBIDDEN) {
					if (pattern.test(text)) hits.push(`${file}:${line} ${why}\n    ${text.trim()}`);
				}
			}
			expect(hits, hits.join('\n')).toEqual([]);
		});

		// PLAN.md rule 1: a module that does not say which section it implements
		// cannot be checked against one.
		it(`${file} names the spec section it implements`, () => {
			const head = readFileSync(join(dir, file), 'utf8').slice(0, 2000);
			expect(head, `${file} has no § reference in its header`).toMatch(/§\d/);
		});
	}
});

describe('the guard itself', () => {
	// Verified by construction rather than by hope: the detector is run against
	// text that should trip it. When this stops failing, the guard is broken.
	it('trips on a replay, a clone and a move generator', () => {
		// The clone sample now names Chess explicitly, matching the amended rule:
		// cloning a BOARD is legitimate, cloning a POSITION and playing on it is
		// the thing being forbidden.
		const sample = `
			const next: Chess = pos.clone();
			next.play(move);
			for (const [from, dests] of pos.allDests()) void from;
		`;
		const lines = code(sample);
		const caught = FORBIDDEN.filter((f) => lines.some(({ text }) => f.pattern.test(text)));
		expect(caught.length).toBe(3);
	});

	it('does not trip on the same words inside comments', () => {
		const sample = `
			// This never calls pos.clone() or next.play(move).
			/* and allDests() is not used either */
			const x = 1;
		`;
		const lines = code(sample);
		expect(FORBIDDEN.filter((f) => lines.some(({ text }) => f.pattern.test(text)))).toEqual([]);
	});
});
