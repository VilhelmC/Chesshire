// Persistence for a game in progress.
//
// Written on every move so nothing is lost by switching tabs, closing the
// laptop, or reloading. ONE ROW PER SCREEN, replaced each time — the history of
// finished runs lives in the `runs` table, not here.
//
// It was one row full stop, belonging to the trainer, which is why Play lost
// its game every time you left the tab: `App` unmounts a view the moment you
// switch away, and a view that writes nothing has nothing to come back to. See
// `SessionKey`.

import { db, type SavedSession, type SessionKey } from './db';

export async function saveSession(
	key: SessionKey,
	s: Omit<SavedSession, 'id' | 'ts'>,
): Promise<void> {
	try {
		await db.session.put({ ...s, id: key, ts: Date.now() });
	} catch {
		/* a lost autosave must never break the move that triggered it */
	}
}

export async function loadSession(key: SessionKey): Promise<SavedSession | null> {
	try {
		const row = (await db.session.get(key)) ?? null;
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

export async function clearSession(key: SessionKey): Promise<void> {
	try {
		await db.session.delete(key);
	} catch {
		/* ignore */
	}
}
