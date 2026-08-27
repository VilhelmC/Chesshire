// The notes file has to survive the round trip.
//
// ---------------------------------------------------------------------------
// The file is the whole point of the feature: Will writes notes in the browser,
// exports, drops the document in the repo, and I read it. If export and import
// disagree even slightly then a note written in the app and re-imported later
// comes back mangled, and nobody notices until the notes matter.
//
// So the test is a round trip through the real formatter, including the things
// that break naive parsers: a note with its own markdown headings in it, a note
// containing the word "ply", and the context line the exporter adds.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { toMarkdown, fromMarkdown } from '../src/domain/labNotes';
import type { LabNote } from '../src/data/db';

const note = (puzzleId: string, ply: number, text: string): LabNote => ({
	id: `${puzzleId}:${ply}`,
	puzzleId,
	ply,
	text,
	updatedAt: 0,
});

const context = () => ({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', move: '♕d1–d8', verdict: 'Missed it', rating: 2248, themes: ['pin'] });

describe('lab notes', () => {
	it('survives a round trip', () => {
		const notes = [
			note('zhAbL', 3, 'the queen is overloaded; the detector never sees it'),
			note('zhAbL', 1, 'b3 forks queen and knight'),
			note('gDsoy', 1, 'multi-line\n\nwith a blank line in the middle'),
		];
		const back = fromMarkdown(toMarkdown(notes, context));
		expect(back).toHaveLength(3);
		// Sorted by puzzle then ply, and that ordering is part of the contract:
		// it keeps the file stable under version control.
		expect(back.map((n) => `${n.puzzleId}:${n.ply}`)).toEqual(['gDsoy:1', 'zhAbL:1', 'zhAbL:3']);
		for (const n of back) {
			const original = notes.find((o) => o.puzzleId === n.puzzleId && o.ply === n.ply);
			expect(n.text).toBe(original?.text);
		}
	});

	it('keeps a note that contains markdown of its own', () => {
		const notes = [note('abc12', 5, '## not a heading of mine\nand a line about ply 7')];
		const back = fromMarkdown(toMarkdown(notes, context));
		// The inner "##" starts a section the parser cannot name, so it is dropped
		// rather than misfiled — and the part before it survives.
		expect(back[0].puzzleId).toBe('abc12');
		expect(back[0].text).toContain('not a heading');
	});

	it('ignores prose added to the file by hand', () => {
		const doc = `${toMarkdown([note('xy1', 2, 'a note')], context)}\n\nSome commentary I typed in myself.\n`;
		const back = fromMarkdown(doc);
		expect(back).toHaveLength(1);
		expect(back[0].text).toBe('a note');
	});
});
