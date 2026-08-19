// Storage for the mistake deck.

import { db } from './db';
import { makeCard, relapse, type MistakeCard } from '../domain/mistakes';

export async function loadMistakes(): Promise<MistakeCard[]> {
	try {
		return await db.mistakes.toArray();
	} catch {
		return [];
	}
}

/**
 * Record a mistake, or bring an existing card back.
 *
 * Meeting the same slip twice is one card with two lapses, not two cards — the
 * deck should reflect what you get wrong, not how many times you have opened
 * the app.
 */
export async function recordMistake(opts: Parameters<typeof makeCard>[0]): Promise<void> {
	try {
		const card = makeCard(opts);
		const existing = await db.mistakes.get(card.id);
		await db.mistakes.put(existing ? relapse(existing, opts.now) : card);
	} catch {
		/* never let bookkeeping break a move */
	}
}

export async function saveCard(card: MistakeCard): Promise<void> {
	try {
		await db.mistakes.put(card);
	} catch {
		/* ignore */
	}
}

export async function deleteCard(id: string): Promise<void> {
	try {
		await db.mistakes.delete(id);
	} catch {
		/* ignore */
	}
}

export async function clearMistakes(): Promise<void> {
	try {
		await db.mistakes.clear();
	} catch {
		/* ignore */
	}
}
