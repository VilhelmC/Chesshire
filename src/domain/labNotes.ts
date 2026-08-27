// Notes on puzzles, and the file they travel in.
//
// ---------------------------------------------------------------------------
// Will: "Maybe we can add an annotation system so its easier for me to make
// notes on the puzzles directly in the app … the text is stored by problem, and
// move number (ply, so for each comment you know what I'm looking at)? Then I can
// just click save to update a document in the local project directory and you can
// see my comments on the problems there directly."
//
// The browser cannot write into the repo, so "click save" is a download and a
// drop into the folder. That makes the FORMAT the important part: the file has
// to be readable as prose by whoever opens it, and parseable exactly enough to
// come back in without loss. So it is markdown with a rigid heading, and the
// importer reads back what the exporter wrote:
//
//     ## zhAbL — ply 3
//     <!-- fen: 6k1/4bppp/... -->
//     the queen is overloaded here, the detector never sees it
//
// One heading per note, one note per position. Nothing else in the file is
// load-bearing, so the surrounding text can be edited freely — including by me,
// which is the point of it being a document rather than a blob.
// ---------------------------------------------------------------------------

import { db, type LabNote } from '../data/db';

export const noteId = (puzzleId: string, ply: number) => `${puzzleId}:${ply}`;

export async function loadNotes(): Promise<Map<string, LabNote>> {
	const rows = await db.labNotes.toArray();
	return new Map(rows.map((r) => [r.id, r]));
}

/** Write one note, or delete it when the text is emptied. */
export async function saveNote(puzzleId: string, ply: number, text: string): Promise<void> {
	const id = noteId(puzzleId, ply);
	const trimmed = text.trim();
	if (!trimmed) {
		await db.labNotes.delete(id);
		return;
	}
	await db.labNotes.put({ id, puzzleId, ply, text: trimmed, updatedAt: Date.now() });
}

export type NoteContext = {
	/** Position the note is about, so the file stands on its own. */
	fen?: string;
	/** The puzzle's move at that ply, in figurine. */
	move?: string;
	/** What the detector made of it. */
	verdict?: string;
	rating?: number;
	themes?: string[];
};

/**
 * The document.
 *
 * Ordered by puzzle then ply so the file is stable: re-exporting after adding one
 * note changes one section rather than reshuffling the whole thing, which is what
 * makes it worth keeping under version control.
 */
/**
 * A heading inside a note would split the file at the wrong place.
 *
 * The parser cuts on a line beginning `## `, so a note that itself starts with
 * one silently loses everything before it. Escaping with a backslash is the
 * markdown-native fix: `\## text` renders as `## text` and no longer looks like
 * a heading to anything reading the file structurally.
 */
const escapeHeadings = (text: string) => text.replace(/^(#{1,6} )/gm, '\\$1');
const unescapeHeadings = (text: string) => text.replace(/^\\(#{1,6} )/gm, '$1');

export function toMarkdown(notes: LabNote[], context: (n: LabNote) => NoteContext): string {
	const sorted = [...notes].sort((a, b) => a.puzzleId.localeCompare(b.puzzleId) || a.ply - b.ply);
	const out: string[] = [
		'# Lab notes',
		'',
		'Written in the Lab, one note per puzzle and ply. The headings are parsed on',
		'import — anything else here is free text.',
		'',
	];
	for (const n of sorted) {
		const c = context(n);
		out.push(`## ${n.puzzleId} — ply ${n.ply}`);
		out.push(`<!-- fen: ${c.fen ?? ''} -->`);
		const facts = [
			c.move ? `move ${c.move}` : null,
			c.verdict ? `detector: ${c.verdict}` : null,
			c.rating ? `rated ${c.rating}` : null,
			c.themes?.length ? c.themes.join(' ') : null,
		].filter(Boolean);
		if (facts.length) out.push(`*${facts.join(' · ')}* — https://lichess.org/training/${n.puzzleId}`);
		out.push('');
		out.push(escapeHeadings(n.text));
		out.push('');
	}
	out.push(`_${sorted.length} notes, exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_`);
	return out.join('\n');
}

/** Read back what `toMarkdown` wrote. Unknown text between sections is ignored. */
export function fromMarkdown(text: string): { puzzleId: string; ply: number; text: string }[] {
	const out: { puzzleId: string; ply: number; text: string }[] = [];
	// The heading is the contract; everything up to the next heading is the note,
	// less the two lines the exporter adds for context.
	const parts = text.split(/^## /m).slice(1);
	for (const part of parts) {
		const head = /^(\S+)\s+—\s+ply\s+(\d+)/.exec(part);
		if (!head) continue;
		const body = part
			.slice(part.indexOf('\n') + 1)
			.split('\n')
			.filter((l) => !/^<!-- fen:/.test(l) && !/^\*.*—\s+https:\/\/lichess\.org/.test(l))
			.join('\n')
			.replace(/^_\d+ notes,[\s\S]*$/m, '')
			.trim();
		if (body) out.push({ puzzleId: head[1], ply: Number(head[2]), text: unescapeHeadings(body) });
	}
	return out;
}
