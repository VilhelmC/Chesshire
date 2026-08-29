// Assembling an explanation — and, mostly, what it refuses to say.
//
// The hand-read gate is `scripts/m3-gate.mjs`, which prints what the panel will
// render over real engine output. What is pinned here is the decision logic, with
// scored options supplied directly: which verdict, which reason, and the two
// cases the gate caught on its first run.
import { describe, it, expect } from 'vitest';
import { explain, shortlist, EQUAL_CP } from '../src/domain/explain';
import type { Scored } from '../src/engine/compare';

/** White to move; ♖d1 and ♜d8 face each other, Black king has luft on h6. */
const FEN = '3r2k1/5pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1';

const opt = (uci: string, san: string, cp: number, pv: string[], mate: number | null = null): Scored => ({
	uci,
	san,
	cp,
	loss: 0,
	pv,
	mate,
});

/** `scoreMoves` returns sorted with `loss` filled; do the same here. */
function ranked(...rows: Scored[]): Scored[] {
	const out = [...rows].sort((a, b) => b.cp - a.cp);
	const top = out[0]?.cp ?? 0;
	for (const r of out) r.loss = r.cp - top;
	return out;
}

describe('the verdict', () => {
	it('says nothing at all about the best move', () => {
		// Silence where silence is right. A "story" attached to the move the engine
		// would play is noise, and the gate checks for it explicitly.
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']), opt('g1h1', 'Kh1', 0, ['g1h1']));
		const x = explain(FEN, 'd1d8', options);
		expect(x.verdict.kind).toBe('best');
		expect(x.verdict.because).toBeUndefined();
	});

	it('calls a near-equal move equal rather than a mistake', () => {
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']), opt('g1h1', 'Kh1', 500 - EQUAL_CP, ['g1h1']));
		expect(explain(FEN, 'g1h1', options).verdict.kind).toBe('equal');
	});

	it('grades by how far behind, once past equal', () => {
		const best = opt('d1d8', 'Rxd8+', 0, ['d1d8', 'g8h7']);
		const grade = (cp: number) => explain(FEN, 'g1h1', ranked(best, opt('g1h1', 'Kh1', cp, ['g1h1']))).verdict.kind;
		expect(grade(-60)).toBe('inaccuracy');
		expect(grade(-150)).toBe('mistake');
		expect(grade(-400)).toBe('blunder');
	});
});

describe('why a move is worse', () => {
	it('names the piece that goes, and whose it was', () => {
		// ♔h1 then ♜xd1 — the rook that goes is OURS, so the sentence is "your rook".
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']), opt('g1h1', 'Kh1', 0, ['g1h1', 'd8d1']));
		const b = explain(FEN, 'g1h1', options).verdict.because;
		expect(b).toMatchObject({ kind: 'material', event: 'captured', piece: 'rook', net: -500 });
	});

	it('does NOT say a piece "goes" when the opponent PROMOTES one', () => {
		// The gate caught this on its first run. On `MU1Mv` the worst ply was `d1=Q`
		// — the opponent making a queen — and the panel rendered "the queen goes".
		// The number was right and the sentence was false: nothing of ours went
		// anywhere, something of theirs arrived.
		const fen = '8/8/8/8/8/k7/3p4/3K4 w - - 0 1';
		const options = ranked(
			opt('d1c2', 'Kc2', 0, ['d1c2', 'a3a2']),
			opt('d1e2', 'Ke2', -800, ['d1e2', 'd2d1q']),
		);
		const b = explain(fen, 'd1e2', options).verdict.because;
		expect(b).toMatchObject({ kind: 'material', event: 'promoted', piece: 'queen' });
	});

	it('puts mate above any material story', () => {
		// A line that ends in mate is not usefully described as losing a rook.
		const options = ranked(
			opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']),
			opt('g1h1', 'Kh1', -9980, ['g1h1', 'd8d1'], -2),
		);
		expect(explain(FEN, 'g1h1', options).verdict.because).toEqual({ kind: 'mateAgainst', in: 2 });
	});

	it('says a better move mates when this one merely does not', () => {
		const options = ranked(
			opt('d1d8', 'Rxd8+', 9980, ['d1d8', 'g8h7'], 2),
			opt('g1h1', 'Kh1', 40, ['g1h1']),
		);
		expect(explain(FEN, 'g1h1', options).verdict.because).toEqual({ kind: 'missedMate', in: 2 });
	});

	it('says "positional" with NO NUMBER when material does not move', () => {
		// The rule the whole module is shaped around. `engineScore − materialDelta`
		// is not a positional evaluation — NNUE has no material term to subtract —
		// so the type carries nothing that could hold one. Asserted structurally,
		// because a comment cannot stop a field being added later.
		const options = ranked(opt('d1d8', 'Rxd8+', 400, ['d1d8', 'g8h7']), opt('g1h1', 'Kh1', 0, ['g1h1']));
		const b = explain(FEN, 'g1h1', options).verdict.because!;
		expect(b.kind).toBe('positional');
		expect(Object.keys(b)).toEqual(['kind']);
	});
});

describe('when the number is not a number', () => {
	it('marks a mate comparison as incomparable', () => {
		// Mate is folded into the ±10000 band so a mate in one outranks a mate in
		// three on a single number. That is right for ORDERING and meaningless as a
		// difference: the gate caught "−110.92 against Nh6+" for a move that simply
		// fails to mate. The ordering still holds; the number is not one to show.
		const options = ranked(
			opt('d1d8', 'Rxd8+', 9980, ['d1d8', 'g8h7'], 2),
			opt('g1h1', 'Kh1', 40, ['g1h1']),
		);
		const v = explain(FEN, 'g1h1', options).verdict;
		expect(v.comparable).toBe(false);
		// And it is still ranked correctly — worse than the mate.
		expect(v.loss).toBeLessThan(0);
	});

	it('marks an ordinary comparison as comparable', () => {
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']), opt('g1h1', 'Kh1', 0, ['g1h1']));
		expect(explain(FEN, 'g1h1', options).verdict.comparable).toBe(true);
	});

	it('refuses to grade a move the engine would not score', () => {
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']));
		const x = explain(FEN, 'g1g2', options);
		expect(x.self).toBeUndefined();
		expect(x.verdict.because).toBeUndefined();
		expect(x.verdict.comparable).toBe(false);
	});
});

describe('the line', () => {
	it('is the engine’s own continuation, and it is traced', () => {
		const options = ranked(opt('d1d8', 'Rxd8+', 500, ['d1d8', 'g8h7']));
		const x = explain(FEN, 'd1d8', options);
		expect(x.line.steps.map((s) => s.san)).toEqual(['Rxd8+', 'Kh7']);
		expect(x.trace.net).toBe(500);
	});

	it('falls back to the move alone when there is no line', () => {
		const options = ranked(opt('d1d8', 'Rxd8+', 500, []));
		expect(explain(FEN, 'd1d8', options).line.steps.map((s) => s.san)).toEqual(['Rxd8+']);
	});
});

describe('shortlist', () => {
	it('always contains the move asked about, however bad it is', () => {
		// Its absence is the one thing the reader would certainly notice.
		const options = ranked(
			opt('a', 'A', 100, []),
			opt('b', 'B', 90, []),
			opt('c', 'C', 80, []),
			opt('d', 'D', 70, []),
			opt('e', 'E', -900, []),
		);
		const short = shortlist(options, 'e', 4);
		expect(short).toHaveLength(4);
		expect(short.map((o) => o.uci)).toContain('e');
	});

	it('leaves a already-included move where it is', () => {
		const options = ranked(opt('a', 'A', 100, []), opt('b', 'B', 90, []));
		expect(shortlist(options, 'b', 4).map((o) => o.uci)).toEqual(['a', 'b']);
	});
});
