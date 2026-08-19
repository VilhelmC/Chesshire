// Persistence for the progress page. Append-only: nothing is ever rewritten, so
// the history stays honest even as the aggregation changes.

import { db } from './db';
import type { AnswerRow, RunRow } from '../domain/progress';

export function logAnswer(row: AnswerRow): void {
	void db.answers.put(row).catch(() => undefined);
}

/** Runs are upserted — the row is written as the run starts and again as it ends. */
export function logRun(row: RunRow): void {
	void db.runs.put(row).catch(() => undefined);
}

export async function loadProgress(): Promise<{ answers: AnswerRow[]; runs: RunRow[] }> {
	try {
		const [answers, runs] = await Promise.all([db.answers.toArray(), db.runs.toArray()]);
		return { answers, runs };
	} catch {
		return { answers: [], runs: [] };
	}
}

export async function clearProgress(): Promise<void> {
	try {
		await Promise.all([db.answers.clear(), db.runs.clear()]);
	} catch {
		/* ignore */
	}
}
