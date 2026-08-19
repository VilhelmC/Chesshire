// Persistence for the run in progress.
//
// Written on every move so nothing is lost by switching tabs, closing the
// laptop, or reloading. One row, replaced each time — the history of finished
// runs lives in the `runs` table, not here.

import { db, type SavedSession } from './db';

export async function saveSession(s: Omit<SavedSession, 'id' | 'ts'>): Promise<void> {
	try {
		await db.session.put({ ...s, id: 'current', ts: Date.now() });
	} catch {
		/* a lost autosave must never break the move that triggered it */
	}
}

export async function loadSession(): Promise<SavedSession | null> {
	try {
		const row = (await db.session.get('current')) ?? null;
		if (!row?.state) return row;
		// A session saved by an older build has the old run shape — it named the
		// lines it was in rather than the position. Fill in what the current shape
		// needs so resuming a game from before the change does not crash.
		const st = row.state as Record<string, unknown>;
		if (!('bookHere' in st)) st.bookHere = [];
		if (!('opening' in st)) st.opening = null;
		return row;
	} catch {
		return null;
	}
}

export async function clearSession(): Promise<void> {
	try {
		await db.session.delete('current');
	} catch {
		/* ignore */
	}
}
