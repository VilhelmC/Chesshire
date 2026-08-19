import { describe, it, expect } from 'vitest';
import {
	mergeEvents,
	mergeMemory,
	mergeMistakes,
	mergeImported,
	totalReport,
} from '../src/domain/merge';
import type { MemoryItem } from '../src/domain/scheduler';
import type { MistakeCard } from '../src/domain/mistakes';

const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
	key: 'k1',
	reps: 3,
	streak: 2,
	lapses: 1,
	lastSeen: 1000,
	dueAt: 5000,
	...over,
});

const card = (over: Partial<MistakeCard> = {}): MistakeCard => ({
	id: 'c1',
	fen: 'x',
	ourColour: 'w',
	expectedUci: 'e2e4',
	expectedSan: 'e4',
	playedSan: 'd4',
	path: ['e4'],
	ply: 1,
	phase: 'book',
	firstSeen: 1000,
	lastSeen: 2000,
	streak: 1,
	lapses: 1,
	dueAt: 5000,
	retired: false,
	...over,
});

describe('append-only history', () => {
	it('unions by id and never rewrites an existing row', () => {
		const mine = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
		const theirs = [{ id: 'b', v: 99 }, { id: 'c', v: 1 }];
		const { rows, report } = mergeEvents(mine, theirs);
		expect(rows.length).toBe(3);
		expect(rows.find((r) => r.id === 'b')!.v).toBe(1);
		expect(report).toEqual({ added: 1, kept: 2, reconciled: 0 });
	});

	it('is idempotent — restoring the same backup twice changes nothing', () => {
		const mine = [{ id: 'a' }, { id: 'b' }];
		const once = mergeEvents(mine, mine).rows;
		const twice = mergeEvents(once, mine).rows;
		expect(twice.length).toBe(2);
	});
});

describe('scheduler state believes the less flattering copy', () => {
	it('takes the LOWER streak', () => {
		const { rows } = mergeMemory([item({ streak: 5 })], [item({ streak: 1 })]);
		expect(rows[0].streak).toBe(1);
	});

	it('takes the EARLIER due date, so the item comes back sooner', () => {
		const { rows } = mergeMemory([item({ dueAt: 9000 })], [item({ dueAt: 3000 })]);
		expect(rows[0].dueAt).toBe(3000);
	});

	it('takes the HIGHER lapse count — a lapse on either device happened', () => {
		const { rows } = mergeMemory([item({ lapses: 1 })], [item({ lapses: 4 })]);
		expect(rows[0].lapses).toBe(4);
	});

	it('takes the later lastSeen and the higher reps, which are facts not claims', () => {
		const { rows } = mergeMemory(
			[item({ lastSeen: 100, reps: 2 })],
			[item({ lastSeen: 900, reps: 7 })],
		);
		expect(rows[0].lastSeen).toBe(900);
		expect(rows[0].reps).toBe(7);
	});

	it('is symmetric — which copy is "mine" cannot change the answer', () => {
		const a = item({ streak: 5, dueAt: 9000, lapses: 1 });
		const b = item({ streak: 1, dueAt: 3000, lapses: 4 });
		const ab = mergeMemory([a], [b]).rows[0];
		const ba = mergeMemory([b], [a]).rows[0];
		expect(ab.streak).toBe(ba.streak);
		expect(ab.dueAt).toBe(ba.dueAt);
		expect(ab.lapses).toBe(ba.lapses);
	});

	it('carries across items the other side has never seen', () => {
		const { rows, report } = mergeMemory([item({ key: 'a' })], [item({ key: 'b' })]);
		expect(rows.length).toBe(2);
		expect(report.added).toBe(1);
	});
});

describe('mistake cards', () => {
	it('does NOT stay retired unless both copies agree', () => {
		// The rule that matters: a card retired on one device and still owed on
		// the other is still owed. Otherwise a restore silently stops asking.
		const { rows } = mergeMistakes([card({ retired: true, streak: 3 })], [card({ retired: false })]);
		expect(rows[0].retired).toBe(false);
	});

	it('stays retired when both agree', () => {
		const { rows } = mergeMistakes(
			[card({ retired: true, streak: 3 })],
			[card({ retired: true, streak: 3 })],
		);
		expect(rows[0].retired).toBe(true);
	});

	it('keeps the earliest firstSeen and the latest lastSeen', () => {
		const { rows } = mergeMistakes(
			[card({ firstSeen: 500, lastSeen: 600 })],
			[card({ firstSeen: 100, lastSeen: 900 })],
		);
		expect(rows[0].firstSeen).toBe(100);
		expect(rows[0].lastSeen).toBe(900);
	});

	it('keeps an origin the other copy is missing', () => {
		const origin = {
			platform: 'lichess' as const,
			url: 'u',
			opponent: 'o',
			playedAt: 1,
			loss: 200,
		};
		const { rows } = mergeMistakes([card()], [card({ origin })]);
		expect(rows[0].origin).toEqual(origin);
	});

	it('never invents mastery: streak down, lapses up, due earlier', () => {
		const { rows } = mergeMistakes(
			[card({ streak: 3, lapses: 1, dueAt: 9000 })],
			[card({ streak: 0, lapses: 5, dueAt: 2000 })],
		);
		expect(rows[0]).toMatchObject({ streak: 0, lapses: 5, dueAt: 2000 });
	});
});

describe('analysed games', () => {
	it('prefers the row that carries the moves', () => {
		const { rows } = mergeImported(
			[{ id: 'g1' }],
			[{ id: 'g1', moves: ['e4', 'e5'] }],
		);
		expect(rows[0].moves).toEqual(['e4', 'e5']);
	});

	it('does not downgrade a row that already has them', () => {
		const { rows } = mergeImported([{ id: 'g1', moves: ['e4'] }], [{ id: 'g1' }]);
		expect(rows[0].moves).toEqual(['e4']);
	});
});

describe('totalReport', () => {
	it('sums', () => {
		expect(
			totalReport({ added: 1, kept: 2, reconciled: 3 }, { added: 10, kept: 20, reconciled: 30 }),
		).toEqual({ added: 11, kept: 22, reconciled: 33 });
	});
});
