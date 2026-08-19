// Getting your training history out, and back in.
//
// ---------------------------------------------------------------------------
// This replaces `exportAll`, which exported `nodes`, `drills`, `attempts` and
// `games` — four tables that are empty and have been for the life of the app.
// It looked exactly like a backup. Wired to a button it would have handed back
// a file containing none of the answers, runs, scheduler state, mistake cards
// or analysed games, and the failure would only have surfaced on the day it
// was needed.
//
// What is included is everything that cannot be recomputed:
//
//   answers, runs      your history. The denominator of every number shown.
//   memory, mistakes   what you know and what you owe.
//   imported           which games have been mined, and their moves.
//   practice           what you are training.
//
// What is deliberately left out:
//
//   explorerCache      free to refetch, and large.
//   evalCache          the same, and larger still. Excluding it keeps a backup
//                      in the tens of kilobytes rather than megabytes; the cost
//                      is a slower first session after a restore.
//   session            the run in progress. Restoring someone else's half-
//                      finished game over yours is never what you wanted.
//   the Lichess token  a credential, not data. It never leaves localStorage.
// ---------------------------------------------------------------------------

import { db } from './db';
import {
	mergeAnswers,
	mergeRuns,
	mergeMemory,
	mergeMistakes,
	mergeImported,
	totalReport,
	type MergeReport,
} from '../domain/merge';
import { loadPractice, savePractice, normalise, type PracticeConfig } from '../domain/practice';
import type { AnswerRow, RunRow } from '../domain/progress';
import type { MemoryItem } from '../domain/scheduler';
import type { MistakeCard } from '../domain/mistakes';
import type { ImportedGameRow } from './db';

/**
 * Bumped only when the shape changes in a way an older build cannot read.
 * A file from the future is refused rather than partially understood.
 */
export const BACKUP_VERSION = 1;

export type Backup = {
	app: 'schackal';
	version: number;
	exportedAt: number;
	practice: PracticeConfig;
	answers: AnswerRow[];
	runs: RunRow[];
	memory: MemoryItem[];
	mistakes: MistakeCard[];
	imported: ImportedGameRow[];
};

export type BackupCounts = Record<string, number>;

export async function makeBackup(): Promise<Backup> {
	const [answers, runs, memory, mistakes, imported] = await Promise.all([
		db.answers.toArray(),
		db.runs.toArray(),
		db.memory.toArray(),
		db.mistakes.toArray(),
		db.imported.toArray(),
	]);

	return {
		app: 'schackal',
		version: BACKUP_VERSION,
		exportedAt: Date.now(),
		practice: loadPractice(),
		answers,
		runs,
		memory,
		mistakes,
		imported,
	};
}

export function countsOf(b: Backup): BackupCounts {
	return {
		answers: b.answers.length,
		runs: b.runs.length,
		memory: b.memory.length,
		mistakes: b.mistakes.length,
		imported: b.imported.length,
	};
}

export class BackupError extends Error {}

/**
 * Read a backup file, refusing anything it cannot fully understand.
 *
 * A partially-understood restore is the worst outcome available here: it
 * succeeds, looks fine, and has quietly dropped whatever the reader did not
 * recognise.
 */
export function parseBackup(text: string): Backup {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new BackupError('That is not a JSON file.');
	}

	const b = raw as Partial<Backup>;
	if (b?.app !== 'schackal') throw new BackupError('That file was not written by this app.');
	if (typeof b.version !== 'number') throw new BackupError('The file has no version.');
	if (b.version > BACKUP_VERSION) {
		throw new BackupError(
			`The file is version ${b.version}; this build understands ${BACKUP_VERSION}. ` +
				'Update the app rather than importing it partially.',
		);
	}

	const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

	return {
		app: 'schackal',
		version: b.version,
		exportedAt: typeof b.exportedAt === 'number' ? b.exportedAt : 0,
		practice: normalise((b.practice ?? {}) as Partial<PracticeConfig>),
		answers: arr<AnswerRow>(b.answers).filter((r) => r && typeof r.id === 'string'),
		runs: arr<RunRow>(b.runs).filter((r) => r && typeof r.id === 'string'),
		memory: arr<MemoryItem>(b.memory).filter((r) => r && typeof r.key === 'string'),
		mistakes: arr<MistakeCard>(b.mistakes).filter((r) => r && typeof r.id === 'string'),
		imported: arr<ImportedGameRow>(b.imported).filter((r) => r && typeof r.id === 'string'),
	};
}

export type RestoreResult = {
	report: MergeReport;
	perTable: Record<string, MergeReport>;
	practiceReplaced: boolean;
};

export type RestoreOptions = {
	/** Take the file's practice settings too. Off by default: it is a preference, not history. */
	replacePractice?: boolean;
};

/**
 * Merge a backup into what is already here.
 *
 * Merge, never replace. Importing on a device that has been used since the
 * export must not throw away what happened in between, and the merge rules
 * (domain/merge.ts) are built so that running this twice changes nothing the
 * second time.
 */
export async function restoreBackup(
	b: Backup,
	opts: RestoreOptions = {},
): Promise<RestoreResult> {
	const [answers, runs, memory, mistakes, imported] = await Promise.all([
		db.answers.toArray(),
		db.runs.toArray(),
		db.memory.toArray(),
		db.mistakes.toArray(),
		db.imported.toArray(),
	]);

	const a = mergeAnswers(answers, b.answers);
	const r = mergeRuns(runs, b.runs);
	const m = mergeMemory(memory, b.memory);
	const c = mergeMistakes(mistakes, b.mistakes);
	const g = mergeImported(imported, b.imported);

	await db.transaction('rw', db.answers, db.runs, db.memory, db.mistakes, db.imported, async () => {
		await db.answers.bulkPut(a.rows);
		await db.runs.bulkPut(r.rows);
		await db.memory.bulkPut(m.rows);
		await db.mistakes.bulkPut(c.rows);
		await db.imported.bulkPut(g.rows);
	});

	if (opts.replacePractice) savePractice(b.practice);

	return {
		report: totalReport(a.report, r.report, m.report, c.report, g.report),
		perTable: {
			answers: a.report,
			runs: r.report,
			memory: m.report,
			mistakes: c.report,
			imported: g.report,
		},
		practiceReplaced: opts.replacePractice === true,
	};
}

// --- durability -------------------------------------------------------------

export type StorageStatus = {
	/** The browser has promised not to evict this origin's data. */
	persisted: boolean;
	/** The browser declined, or does not support the request. */
	supported: boolean;
	usageBytes: number | null;
	quotaBytes: number | null;
};

/**
 * Ask the browser to stop treating this data as disposable.
 *
 * IndexedDB is evictable by default: under storage pressure the browser is
 * entitled to delete it, and everything the app knows about you lives there.
 * The request is idempotent and usually granted silently once a site has been
 * used a few times or installed.
 */
export async function requestPersistence(): Promise<StorageStatus> {
	const s = navigator.storage;
	if (!s?.persist) return { persisted: false, supported: false, usageBytes: null, quotaBytes: null };

	let persisted = false;
	try {
		persisted = (await s.persisted?.()) ?? false;
		if (!persisted) persisted = await s.persist();
	} catch {
		/* treated as "not granted" */
	}

	let usageBytes: number | null = null;
	let quotaBytes: number | null = null;
	try {
		const est = await s.estimate?.();
		usageBytes = est?.usage ?? null;
		quotaBytes = est?.quota ?? null;
	} catch {
		/* estimates are a nicety */
	}

	return { persisted, supported: true, usageBytes, quotaBytes };
}
