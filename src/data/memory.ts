// Persistence for the scheduler.
//
// Held in a Map in memory so the sampling path stays synchronous — the opponent
// picks a move inside a weighted sample, and awaiting IndexedDB per candidate
// would make that needlessly slow. Writes go through to Dexie in the background.

import { db } from './db';
import type { MemoryItem, MemoryStore } from '../domain/scheduler';

export async function loadMemory(): Promise<MemoryStore> {
	try {
		const rows = await db.memory.toArray();
		return new Map(rows.map((r) => [r.key, r]));
	} catch {
		return new Map();
	}
}

export function persist(item: MemoryItem): void {
	void db.memory.put(item).catch(() => undefined);
}

export async function clearMemory(): Promise<void> {
	try {
		await db.memory.clear();
	} catch {
		/* ignore */
	}
}
