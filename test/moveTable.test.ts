// One row per move, however many lists it is in.
//
// The three buttons this replaces produced three shapes of row, and a move in
// two of them appeared twice with different columns filled. What is pinned here
// is the merge — and, more than the merge, the refusals: an unevaluated move
// shows blank rather than zero, and a gap between a mate and a centipawn is not
// a number.
import { describe, it, expect } from 'vitest';
import { mergeMoves, withScores, filterMoves, lossText, evalText, type MoveSource } from '../src/domain/moveTable';

const cand = (uci: string, san: string, cp: number, loss = 0) => ({ uci, san, cp, loss, grade: 0 });
const share = (uci: string, san: string, games: number, s = 0.5) => ({
	uci,
	san,
	games,
	share: games / 100,
	score: s,
	rating: null,
});

describe('the merge', () => {
	it('gives a move in three lists ONE row with three tags', () => {
		const rows = mergeMoves({
			line: [{ uci: 'e2e4', san: 'e4' }],
			engine: [cand('e2e4', 'e4', 30)],
			popular: [share('e2e4', 'e4', 60)],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].sources.sort()).toEqual(['engine', 'line', 'popular']);
		expect(rows[0].cp).toBe(30);
		expect(rows[0].games).toBe(60);
	});

	it('keeps a move that only one list has', () => {
		// The failure mode of three separate views: a popular move the engine did
		// not rank simply was not on the engine's list, so it was invisible unless
		// you knew to press a different button.
		const rows = mergeMoves({
			engine: [cand('e2e4', 'e4', 30)],
			popular: [share('b1c3', 'Nc3', 12)],
		});
		expect(rows.map((r) => r.uci)).toContain('b1c3');
		expect(rows.find((r) => r.uci === 'b1c3')!.cp).toBeNull();
	});

	it('sorts evaluated moves first, best first, then by how often played', () => {
		const rows = mergeMoves({
			engine: [cand('e2e4', 'e4', 30), cand('d2d4', 'd4', 10)],
			popular: [share('b1c3', 'Nc3', 90), share('g1f3', 'Nf3', 5)],
		});
		expect(rows.map((r) => r.san)).toEqual(['e4', 'd4', 'Nc3', 'Nf3']);
	});

	it('never invents an evaluation', () => {
		// A zero would read as "equal", which is a claim. Null is the truth, and
		// `evalText` renders it as an ellipsis rather than a number.
		const rows = mergeMoves({ line: [{ uci: 'e2e4', san: 'e4' }] });
		expect(rows[0].cp).toBeNull();
		expect(rows[0].loss).toBeNull();
		expect(evalText(rows[0])).toBe('…');
	});
});

describe('filling in evaluations later', () => {
	it('fills the rows the host paid for and leaves the rest', () => {
		// The explorer answers in a round trip and the engine takes a search per
		// move, so a table that waited for everything would show nothing for
		// seconds. Rows arrive unevaluated.
		const rows = mergeMoves({ popular: [share('e2e4', 'e4', 60), share('d2d4', 'd4', 30)] });
		const filled = withScores(rows, [{ uci: 'e2e4', cp: 25, loss: 0 }]);
		expect(filled.find((r) => r.uci === 'e2e4')!.cp).toBe(25);
		expect(filled.find((r) => r.uci === 'd2d4')!.cp).toBeNull();
	});
});

describe('the filters', () => {
	const rows = mergeMoves({
		line: [{ uci: 'e2e4', san: 'e4' }],
		engine: [cand('e2e4', 'e4', 30), cand('d2d4', 'd4', 10)],
		popular: [share('b1c3', 'Nc3', 90)],
	});

	it('an empty set means everything, not nothing', () => {
		expect(filterMoves(rows, new Set())).toHaveLength(3);
	});

	it('one filter admits exactly its own tag', () => {
		expect(filterMoves(rows, new Set<MoveSource>(['line'])).map((r) => r.san)).toEqual(['e4']);
		expect(filterMoves(rows, new Set<MoveSource>(['engine'])).map((r) => r.san)).toEqual([
			'e4',
			'd4',
		]);
	});

	it('TWO filters admit what both claim, not what either does', () => {
		// The union would give e4 and d4 here: d4 is the engine's but is not in
		// the line. Under the intersection the question is "what do the line and
		// the engine agree on", and the answer is e4.
		const on = new Set<MoveSource>(['line', 'engine']);
		expect(filterMoves(rows, on).map((r) => r.san)).toEqual(['e4']);
	});

	it('narrows with every filter added, never widens', () => {
		const grow: MoveSource[] = ['engine', 'line', 'popular'];
		const on = new Set<MoveSource>();
		let last = filterMoves(rows, on).length;
		for (const s of grow) {
			on.add(s);
			const now = filterMoves(rows, on).length;
			expect(now).toBeLessThanOrEqual(last);
			last = now;
		}
	});

	it('admits nothing when the sources share no move, and that is an answer', () => {
		// Nc3 is popular and nothing else; e4 is in the line and is not popular.
		// An empty table here is the finding, not a fault — `MoveTable` says so
		// in words rather than showing a bare "nothing to show".
		const on = new Set<MoveSource>(['line', 'popular']);
		expect(filterMoves(rows, on)).toEqual([]);
	});

	it('keeps a move that carries every tag', () => {
		const all = mergeMoves({
			line: [{ uci: 'e2e4', san: 'e4' }],
			engine: [cand('e2e4', 'e4', 30)],
			popular: [share('e2e4', 'e4', 90)],
		});
		const on = new Set<MoveSource>(['line', 'engine', 'popular']);
		expect(filterMoves(all, on).map((r) => r.san)).toEqual(['e4']);
	});
});

describe('loss, when the subtraction is not a subtraction', () => {
	const mate = { ...mergeMoves({ engine: [cand('a1a8', 'Ra8#', 9990)] })[0] };
	const quiet = { ...mergeMoves({ engine: [cand('g1h1', 'Kh1', -40)] })[0] };

	it('says "no mate" rather than a hundred pawns', () => {
		// This shipped once already: every move in a mating position read "−100.97".
		// Mate is folded into ±10000 so it outranks any evaluation on one number —
		// right for ordering, meaningless as a difference.
		expect(lossText(quiet, mate)).toBe('no mate');
	});

	it('says "slower" between two mates of different length', () => {
		const slower = { ...mergeMoves({ engine: [cand('b1b8', 'Rb8#', 9970)] })[0] };
		expect(lossText(slower, mate)).toBe('slower');
	});

	it('gives the real gap when both sides are centipawns', () => {
		const best = { ...mergeMoves({ engine: [cand('e2e4', 'e4', 30)] })[0] };
		const worse = { ...mergeMoves({ engine: [cand('a2a3', 'a3', -70, -100)] })[0] };
		expect(lossText(worse, best)).toBe('−1.00');
	});

	it('says nothing at all about a move with no evaluation', () => {
		const unknown = { ...mergeMoves({ line: [{ uci: 'e2e4', san: 'e4' }] })[0] };
		expect(lossText(unknown, mate)).toBe('');
	});
});
