// Merging two copies of your training history.
//
// ---------------------------------------------------------------------------
// This is the part of syncing that has to be right, and the only part that
// cannot be fixed later: a bad merge does not fail, it quietly rewrites what
// you know. Everything else — where the file lives, who you signed in as — is
// plumbing that can be swapped.
//
// One rule governs the whole file:
//
//   WHEN TWO COPIES DISAGREE ABOUT HOW WELL YOU KNOW SOMETHING,
//   BELIEVE THE LESS FLATTERING ONE.
//
// The asymmetry is deliberate. Restoring a backup that says you have retired a
// card you have not learned costs you the card — you stop being asked, and you
// never find out. Restoring one that says you still owe it costs you one extra
// repetition. Those are not equal, so the tie is not broken by recency.
//
// History is different: answers and runs are events, and events are appended,
// never reconciled. Two devices that both recorded an answer both witnessed it.
// ---------------------------------------------------------------------------

import type { AnswerRow, RunRow } from './progress';
import type { MistakeCard } from './mistakes';
import type { MemoryItem } from './scheduler';

export type MergeReport = {
	added: number;
	kept: number;
	/** Rows present in both, where the merge had to choose. */
	reconciled: number;
};

const empty = (): MergeReport => ({ added: 0, kept: 0, reconciled: 0 });

/**
 * Append-only history: union by id, existing rows win.
 *
 * An id collision means the same event, so there is nothing to reconcile. Rows
 * are never rewritten, which is what makes the history trustworthy as the
 * denominator of everything else.
 */
export function mergeEvents<T extends { id: string }>(
	mine: T[],
	theirs: T[],
): { rows: T[]; report: MergeReport } {
	const report = empty();
	const byId = new Map<string, T>();
	for (const r of mine) byId.set(r.id, r);
	report.kept = byId.size;

	for (const r of theirs) {
		if (byId.has(r.id)) continue;
		byId.set(r.id, r);
		report.added++;
	}
	return { rows: [...byId.values()], report };
}

export const mergeAnswers = (a: AnswerRow[], b: AnswerRow[]) => mergeEvents(a, b);
export const mergeRuns = (a: RunRow[], b: RunRow[]) => mergeEvents(a, b);

/**
 * Scheduler state, reconciled pessimistically.
 *
 * `streak` takes the LOWER of the two and `dueAt` the EARLIER: the copy that
 * thinks you are less far along wins, and the item comes back sooner. Lapses
 * take the higher, because a lapse is an event that happened on one of the two
 * devices and forgetting it would understate how hard the item is.
 */
export function mergeMemory(
	mine: MemoryItem[],
	theirs: MemoryItem[],
): { rows: MemoryItem[]; report: MergeReport } {
	const report = empty();
	const byKey = new Map<string, MemoryItem>();
	for (const m of mine) byKey.set(m.key, m);
	report.kept = byKey.size;

	for (const t of theirs) {
		const m = byKey.get(t.key);
		if (!m) {
			byKey.set(t.key, t);
			report.added++;
			continue;
		}
		report.reconciled++;
		byKey.set(t.key, {
			...m,
			streak: Math.min(m.streak, t.streak),
			lapses: Math.max(m.lapses, t.lapses),
			dueAt: Math.min(m.dueAt, t.dueAt),
			// "Last seen" and the repetition count are facts about the past, not
			// claims about mastery, so the larger one is simply the true one.
			lastSeen: Math.max(m.lastSeen, t.lastSeen),
			reps: Math.max(m.reps, t.reps),
		});
	}
	return { rows: [...byKey.values()], report };
}

/**
 * Mistake cards, reconciled the same way.
 *
 * A card retired on one device and still owed on the other is NOT retired. That
 * is the whole rule in one line: `retired` only survives if both agree.
 */
export function mergeMistakes(
	mine: MistakeCard[],
	theirs: MistakeCard[],
): { rows: MistakeCard[]; report: MergeReport } {
	const report = empty();
	const byId = new Map<string, MistakeCard>();
	for (const c of mine) byId.set(c.id, c);
	report.kept = byId.size;

	for (const t of theirs) {
		const m = byId.get(t.id);
		if (!m) {
			byId.set(t.id, t);
			report.added++;
			continue;
		}
		report.reconciled++;
		const streak = Math.min(m.streak, t.streak);
		byId.set(t.id, {
			// Keep the richer record where it is not a claim about mastery: a card
			// that gained an `origin` on one device should keep it.
			...m,
			...(m.origin ? {} : t.origin ? { origin: t.origin } : {}),
			...(m.opening ? {} : t.opening ? { opening: t.opening } : {}),
			streak,
			lapses: Math.max(m.lapses, t.lapses),
			firstSeen: Math.min(m.firstSeen, t.firstSeen),
			lastSeen: Math.max(m.lastSeen, t.lastSeen),
			dueAt: Math.min(m.dueAt, t.dueAt),
			retired: m.retired && t.retired,
		});
	}
	return { rows: [...byId.values()], report };
}

/** Analysed-game bookkeeping: union by id, richer row wins. */
export function mergeImported<T extends { id: string; moves?: string[] }>(
	mine: T[],
	theirs: T[],
): { rows: T[]; report: MergeReport } {
	const report = empty();
	const byId = new Map<string, T>();
	for (const r of mine) byId.set(r.id, r);
	report.kept = byId.size;

	for (const t of theirs) {
		const m = byId.get(t.id);
		if (!m) {
			byId.set(t.id, t);
			report.added++;
			continue;
		}
		// A row that carries the game's moves is strictly more useful than one
		// that does not — that is what the transfer measurement needs.
		if (!m.moves?.length && t.moves?.length) {
			byId.set(t.id, t);
			report.reconciled++;
		}
	}
	return { rows: [...byId.values()], report };
}

export function totalReport(...reports: MergeReport[]): MergeReport {
	return reports.reduce(
		(acc, r) => ({
			added: acc.added + r.added,
			kept: acc.kept + r.kept,
			reconciled: acc.reconciled + r.reconciled,
		}),
		empty(),
	);
}
