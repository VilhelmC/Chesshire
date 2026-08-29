// The `go` line, and the two rules about it that cost a debugging session each.
//
// The engine itself cannot run in vitest — it is a Web Worker — so what is pinned
// here is the command construction, which is where both known traps live.
// The behaviour of `searchmoves` itself is measured by `scripts/m0-gate.mjs` and
// `scripts/m0-exactness.mjs` against a real engine in Node.
import { describe, it, expect } from 'vitest';
import { goCommand, parseInfo } from '../src/engine/stockfish';

describe('the go command', () => {
	it('uses movetime when given, depth otherwise', () => {
		expect(goCommand(14)).toBe('go depth 14');
		expect(goCommand(14, 300)).toBe('go movetime 300');
	});

	it('puts searchmoves LAST, always', () => {
		// Stockfish consumes every token after `searchmoves` into the move list —
		// its own parser carries the comment "needs to be the last command on the
		// line". A `movetime` appended afterwards is swallowed as a move and the
		// search runs unbounded: nothing errors, it just never returns.
		const withTime = goCommand(14, 300, ['e2e4', 'd2d4']);
		expect(withTime).toBe('go movetime 300 searchmoves e2e4 d2d4');
		expect(withTime.indexOf('searchmoves')).toBeGreaterThan(withTime.indexOf('movetime'));

		const withDepth = goCommand(14, undefined, ['e2e4']);
		expect(withDepth).toBe('go depth 14 searchmoves e2e4');
		expect(withDepth.indexOf('searchmoves')).toBeGreaterThan(withDepth.indexOf('depth'));
	});

	it('omits searchmoves entirely when there are none', () => {
		// An empty `searchmoves` with no moves after it would restrict the search to
		// nothing at all.
		expect(goCommand(14, 300, [])).toBe('go movetime 300');
		expect(goCommand(14, 300, undefined)).toBe('go movetime 300');
	});
});

describe('parseInfo', () => {
	it('reads a multipv line', () => {
		const l = parseInfo('info depth 15 seldepth 20 multipv 2 score cp -23 nodes 1 pv h2h4 e7e5');
		expect(l).toEqual({ multipv: 2, cp: -23, mate: null, depth: 15, pv: ['h2h4', 'e7e5'] });
	});

	it('maps mate scores so a shorter mate outranks a longer one', () => {
		const fast = parseInfo('info depth 9 multipv 1 score mate 1 pv d8h4')!;
		const slow = parseInfo('info depth 9 multipv 1 score mate 3 pv d1h5')!;
		expect(fast.cp).toBeGreaterThan(slow.cp);
		expect(parseInfo('info depth 9 multipv 1 score mate -2 pv a1a2')!.cp).toBeLessThan(-9000);
	});

	it('ignores lines that are not evaluations', () => {
		expect(parseInfo('info string NNUE evaluation using nn-9067e33176e')).toBeNull();
		expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull();
		// No `pv` — a currmove report, not a result.
		expect(parseInfo('info depth 20 currmove e2e4 currmovenumber 1')).toBeNull();
	});
});
