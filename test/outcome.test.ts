// What a move leaves behind, and the two very different rules for it.
//
// ---------------------------------------------------------------------------
// These ~100 lines lived inside `Train.tsx`'s `onMove` and could not be tested
// there: reaching them needed a rendered view, an engine and a token. Pulling
// them out to answer "how much of the trainer is about training" had the side
// effect of making them checkable, and what they encode is worth checking —
// every rule below was written to fix a specific wrong number.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const logAnswer = vi.fn();
const recordMistake = vi.fn();
vi.mock('../src/data/progress', () => ({ logAnswer: (r: unknown) => logAnswer(r) }));
vi.mock('../src/data/mistakes', () => ({ recordMistake: (r: unknown) => recordMistake(r) }));

const { recordOutcome } = await import('../src/data/outcome');
type RunState = import('../src/engine/session').RunState;

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const state = (over: Partial<RunState> = {}): RunState =>
	({
		fen: FEN,
		path: ['e4', 'e5'],
		ourColour: 'w',
		mode: 'drill',
		phase: 'book',
		opening: null,
		bookHere: [],
		expected: [{ uci: 'g1f3', san: 'Nf3' }],
		lastOpponent: null,
		motifs: [],
		evalNow: null,
		punishPlies: 0,
		finished: null,
		note: null,
		deviationPoint: null,
		retryPoint: null,
		branchPoint: null,
		currentItem: null,
		...over,
	}) as unknown as RunState;

const call = (over: Record<string, unknown> = {}) =>
	recordOutcome({
		before: state(),
		out: { correct: false, cpLoss: 120, played: 'a3' },
		uci: 'a2a3',
		runId: 'r1',
		assisted: false,
		revealed: false,
		once: { logged: false, mistake: false },
		sanOf: () => 'Nf3',
		...over,
	} as Parameters<typeof recordOutcome>[0]);

beforeEach(() => {
	logAnswer.mockReset();
	recordMistake.mockReset();
});

describe('the drill', () => {
	it('logs one row per encounter, not one per retry', () => {
		const once = { logged: false, mistake: false };
		call({ once });
		call({ once });
		expect(logAnswer).toHaveBeenCalledTimes(1);
	});

	it('does not log a novelty as an answer', () => {
		// The position has not moved and the drill is still asking; whatever is
		// played next is the answer. Logging this as `correct: false` put the
		// error back in through the progress record after the card had been kept
		// out of the mistakes bin.
		const once = { logged: false, mistake: false };
		call({ once, out: { correct: false, cpLoss: 0, played: 'd4', novelty: { edge: 5 } } });
		expect(logAnswer).not.toHaveBeenCalled();
		// And deliberately still unlogged, so the next move gets the row.
		expect(once.logged).toBe(false);
	});

	it('makes no card for a novelty', () => {
		// Will: "it should not count as error … The card does not go into the
		// opening mistakes bin."
		call({ out: { correct: false, cpLoss: 0, played: 'd4', novelty: { edge: 5 } } });
		expect(recordMistake).not.toHaveBeenCalled();
	});

	it('makes a card for the first miss only', () => {
		const once = { logged: false, mistake: false };
		call({ once });
		call({ once });
		expect(recordMistake).toHaveBeenCalledTimes(1);
	});

	it('does not count a correct answer that was helped', () => {
		call({ out: { correct: true, cpLoss: 0, played: 'Nf3' }, assisted: true });
		expect(logAnswer.mock.calls[0][0]).toMatchObject({ correct: false, assisted: true });
	});

	it('writes the stored phase, not the in-memory one', () => {
		// `progress.ts` selects on these strings and has real history behind it.
		call({ before: state({ mode: 'drill', phase: 'punish' }) });
		expect(logAnswer.mock.calls[0][0]).toMatchObject({ phase: 'punish' });
	});
});

describe('free play', () => {
	const free = () => state({ mode: 'free', expected: [] });

	it('logs every measurable move, however it went', () => {
		// It is the only source feeding the rating estimate, and an earlier
		// version skipped it entirely.
		call({ before: free(), out: { correct: false, cpLoss: 45, played: 'a3' } });
		expect(logAnswer.mock.calls[0][0]).toMatchObject({ phase: 'freeplay', cpLoss: 45 });
	});

	it('logs every move, not one per encounter', () => {
		// The drill's `once` rule is about an item being answered. A game has no
		// items, and rate-limiting its rows would throw away the measurement.
		const once = { logged: false, mistake: false };
		call({ before: free(), once, out: { correct: false, cpLoss: 10, played: 'a3' } });
		call({ before: free(), once, out: { correct: false, cpLoss: 20, played: 'a4' } });
		expect(logAnswer).toHaveBeenCalledTimes(2);
	});

	it('refuses to log an unmeasured move as a perfect one', () => {
		// A negative loss is the sentinel for "could not be measured". Logging it
		// as zero recorded a flawless move every time the engine hiccupped, which
		// is how the rating estimate drifted upwards.
		call({ before: free(), out: { correct: false, cpLoss: -1, played: 'a3' } });
		expect(logAnswer).not.toHaveBeenCalled();
	});

	it('records it as correct, because there is nothing to be wrong against', () => {
		// No expected set exists in a game. The row is kept for its COST; marking
		// it incorrect would drag down accuracy counts that are about recall.
		call({ before: free(), out: { correct: false, cpLoss: 45, played: 'a3' } });
		expect(logAnswer.mock.calls[0][0]).toMatchObject({ correct: true, assisted: false });
	});

	it('leaves a small error alone', () => {
		call({ before: free(), out: { correct: false, cpLoss: 199, played: 'a3' } });
		expect(recordMistake).not.toHaveBeenCalled();
	});
});
