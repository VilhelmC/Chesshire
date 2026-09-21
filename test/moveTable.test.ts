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

// ---------------------------------------------------------------------------
// THE MOVE YOU ASKED FOR BY NAME.
//
// The filter answers "which moves do these sources agree on". A revealed
// answer is not an answer to that question — it IS the question — so a filter
// that removed it would let "show me the move" produce a table without the
// move in it.
// ---------------------------------------------------------------------------
describe('a kept move', () => {
	const rows = mergeMoves({
		engine: [cand('e2e4', 'e4', 30), cand('d2d4', 'd4', 20)],
		popular: [share('e2e4', 'e4', 90)],
		line: [{ uci: 'a2a3', san: 'a3' }],
	});

	it('survives a filter that admits nothing else of its kind', () => {
		const on = new Set<MoveSource>(['engine', 'popular']);
		expect(filterMoves(rows, on).map((r) => r.san)).toEqual(['e4']);
		expect(filterMoves(rows, on, 'a2a3').map((r) => r.san).sort()).toEqual(['a3', 'e4']);
	});

	it('is not duplicated when the filter would have admitted it anyway', () => {
		const on = new Set<MoveSource>(['engine']);
		expect(filterMoves(rows, on, 'e2e4').filter((r) => r.san === 'e4')).toHaveLength(1);
	});

	it('changes nothing when no filter is active — everything already shows', () => {
		const none = new Set<MoveSource>();
		expect(filterMoves(rows, none, 'a2a3')).toEqual(filterMoves(rows, none));
	});

	it('is ignored when it names a move that is not here', () => {
		const on = new Set<MoveSource>(['engine', 'popular']);
		expect(filterMoves(rows, on, 'h2h4').map((r) => r.san)).toEqual(['e4']);
	});
});

// ---------------------------------------------------------------------------
// ASKED AND ABSENT IS NOT THE SAME AS NOT ASKED.
//
// Will: "why are not all moves listed with 'played' statistics? … It irritates
// me that the table has different grammars for different categories." Two
// different things were rendering as the same empty cell.
// ---------------------------------------------------------------------------
describe('a move the explorer has never heard of', () => {
	it('reads zero once the explorer has answered', () => {
		const rows = mergeMoves({
			engine: [cand('a2a3', 'a3', 5)],
			popular: [share('e2e4', 'e4', 90)],
		});
		const a3 = rows.find((r) => r.san === 'a3')!;
		expect(a3.games).toBe(0);
		expect(a3.share).toBe(0);
	});

	it('still reads blank when nobody asked', () => {
		const rows = mergeMoves({ engine: [cand('a2a3', 'a3', 5)] });
		expect(rows[0].games).toBeNull();
		expect(rows[0].share).toBeNull();
	});

	it('claims no score for a move with no games', () => {
		// A score is an average over games. Zero here would say the move loses
		// every time, which is a claim about chess rather than about the data.
		const rows = mergeMoves({ engine: [cand('a2a3', 'a3', 5)], popular: [] });
		expect(rows[0].score).toBeNull();
	});

	it('is not tagged popular merely for having a zero in the column', () => {
		// The count is data; the TAG is what the filter reads. A move nobody plays
		// must not start satisfying the "played" chip.
		const rows = mergeMoves({ engine: [cand('a2a3', 'a3', 5)], popular: [] });
		expect(rows[0].sources).toEqual(['engine']);
	});

	it('leaves a move the explorer did list alone', () => {
		const rows = mergeMoves({ popular: [share('e2e4', 'e4', 90, 0.55)] });
		expect(rows[0].games).toBe(90);
		expect(rows[0].score).toBe(0.55);
	});
});

// ---------------------------------------------------------------------------
// HAVING AN EVALUATION IS NOT THE SAME AS BEING RECOMMENDED.
//
// Will: "now when I filter 'engine' it includes all moves, but we want the old
// meaning of engine, which was 'the top 5 moves', so it actually filters
// something."
//
// Asking the engine for every legal move — which is what gives every row a
// score — also tagged every legal move `engine`, so the chip selected the whole
// table. The two lists are separate now: `engine` is the shortlist and carries
// the tag, `scores` fills numbers and carries nothing.
// ---------------------------------------------------------------------------
describe('scores that are not a recommendation', () => {
	const sources = {
		line: [{ uci: 'a2a3', san: 'a3' }],
		engine: [cand('e2e4', 'e4', 30), cand('d2d4', 'd4', 20)],
		scores: [
			{ uci: 'e2e4', cp: 30, loss: 0 },
			{ uci: 'a2a3', cp: -40, loss: 70 },
			{ uci: 'h2h4', cp: -90, loss: 120 },
		],
	};

	it('gives a book move an evaluation without calling it an engine pick', () => {
		const a3 = mergeMoves(sources).find((r) => r.san === 'a3')!;
		expect(a3.cp).toBe(-40);
		expect(a3.loss).toBe(70);
		expect(a3.sources).toEqual(['line']);
	});

	it('leaves the shortlist filterable', () => {
		const rows = mergeMoves(sources);
		const on = new Set<MoveSource>(['engine']);
		// The whole point: with a3 scored but untagged, the chip still narrows.
		expect(filterMoves(rows, on).map((r) => r.san)).toEqual(['e4', 'd4']);
	});

	it('does not admit a move whose only claim is having been scored', () => {
		// h2h4 is in `scores` and nowhere else. It is legal, it has a number, and
		// nobody has any reason to see it — listing every legal move is the thing
		// the table exists to avoid.
		expect(mergeMoves(sources).map((r) => r.san)).not.toContain('h4');
	});

	it('does not overwrite a score the shortlist already gave', () => {
		const rows = mergeMoves({
			engine: [cand('e2e4', 'e4', 30, 0)],
			scores: [{ uci: 'e2e4', cp: 999, loss: 999 }],
		});
		expect(rows[0].cp).toBe(30);
	});
});
