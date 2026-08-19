// Scheduling: how often the opponent replays a move you have already met.
//
// Without this the opponent samples purely by real-world frequency, so the most
// common mistake comes up over and over while the rare ones you have never
// solved barely appear — the opposite of what helps. Each correct answer pushes
// a move further out; each miss brings it straight back.
//
// The weights feed the same weighted sample the opponent already used, so
// realism and scheduling multiply rather than compete: a move still has to be
// something players actually play, it just stops dominating once you know it.

export type MemoryItem = {
	/** positionKey|uci — the opponent move, in the position it was played. */
	key: string;
	reps: number;
	/** Consecutive correct answers. Resets to zero on a miss. */
	streak: number;
	lapses: number;
	lastSeen: number;
	dueAt: number;
};

/**
 * Expanding intervals, in milliseconds.
 *
 * The first few are minutes rather than days on purpose: a run lasts a couple
 * of minutes, so a scheduler working only in days would let the same mistake
 * repeat five times in one sitting. The tail reaches genuine spaced-repetition
 * distances for things you have solved repeatedly.
 */
const INTERVALS = [
	60_000, // 1 min
	5 * 60_000, // 5 min
	25 * 60_000, // 25 min
	2 * 3600_000, // 2 h
	12 * 3600_000, // 12 h
	3 * 86_400_000, // 3 d
	10 * 86_400_000, // 10 d
	30 * 86_400_000, // 30 d
];

export function intervalFor(streak: number): number {
	return INTERVALS[Math.min(Math.max(streak, 0), INTERVALS.length - 1)];
}

export function newItem(key: string, now: number): MemoryItem {
	return { key, reps: 0, streak: 0, lapses: 0, lastSeen: 0, dueAt: now };
}

/**
 * Sampling weight, multiplied into the move's real-world frequency.
 *
 * Unseen moves get full weight. Solved ones are suppressed until due, but never
 * to zero — a repertoire where a line becomes permanently unreachable is one you
 * will be surprised by eventually.
 */
export function weightFor(item: MemoryItem | undefined, now: number): number {
	if (!item || item.reps === 0) return 1;

	const remaining = item.dueAt - now;
	if (remaining > 0) {
		const horizon = Math.max(intervalFor(item.streak), 1);
		const fraction = Math.min(1, remaining / horizon);
		// Freshly answered -> heavily suppressed; approaching due -> back towards
		// normal. The floor keeps everything reachable.
		return Math.max(0.03, 0.4 * (1 - fraction));
	}

	// Due or overdue. Things you have got wrong before come back harder.
	return 1 + Math.min(2, item.lapses * 0.5);
}

export function afterAnswer(item: MemoryItem, correct: boolean, now: number): MemoryItem {
	const streak = correct ? item.streak + 1 : 0;
	return {
		...item,
		reps: item.reps + 1,
		streak,
		lapses: item.lapses + (correct ? 0 : 1),
		lastSeen: now,
		dueAt: now + intervalFor(streak),
	};
}

export type MemoryStore = Map<string, MemoryItem>;

export function itemKey(positionKey: string, uci: string): string {
	return `${positionKey}|${uci}`;
}

/** Counts for the progress panel. */
export function summarise(store: MemoryStore, now: number) {
	let due = 0;
	let learning = 0;
	let known = 0;
	for (const item of store.values()) {
		if (item.dueAt <= now) due++;
		if (item.streak >= 3) known++;
		else if (item.reps > 0) learning++;
	}
	return { total: store.size, due, learning, known };
}
