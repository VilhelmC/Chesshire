// The picture has to be the graph.
//
// A wrong overlay is worse than none: it is a confident diagram of something
// that is not happening, and it will be trusted because it is visual. So the
// shapes are asserted against the edges they claim to draw, not eyeballed.
import { describe, it, expect } from 'vitest';
import { parseSquare } from 'chessops/util';
import { positionFromFen } from '../src/domain/chess';
import { build } from '../src/domain/graph';
import { makeSquare } from 'chessops/util';
import { shapesFor, motifsIn, describe as read } from '../src/domain/graphShapes';

const at = (fen: string) => positionFromFen(fen);
// Rook a1 behind its own pawn a2; black king h1 for legality.
const board = at('8/8/8/8/8/8/P7/R3K2k w - - 0 1').board;
const g = build(board);
const a1 = parseSquare('a1');

describe('overlay layers', () => {
	it('draws nothing when off', () => {
		expect(shapesFor(g, 'off')).toEqual([]);
	});

	it('draws one arrow per live edge, focused', () => {
		const s = shapesFor(g, 'attacks', a1, board);
		expect(s.every((x) => x.dest !== undefined)).toBe(true);
		expect(s.map((x) => x.dest).sort()).toEqual(['a2', 'b1', 'c1', 'd1', 'e1']);
	});

	// Nine, not six. The rook x-rays a3-a8 through its own pawn AND f1-h1 through
	// the king — which the probe showed and I did not read before writing the
	// first version of this expectation. Left as a comment because the mistake is
	// the point: a latent edge through a KING is exactly the structure a pin is
	// made of, and it would have been asserted away.
	it('draws the x-ray as its own layer, through every blocker', () => {
		const s = shapesFor(g, 'latent', a1, board);
		expect(s.map((x) => x.dest).sort()).toEqual([
			'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'f1', 'g1', 'h1',
		]);
	});

	// A sensitive square is a property of the square, so it gets a circle. An
	// arrow would invent a direction the fact does not have.
	it('draws sensitive squares as circles, never arrows', () => {
		const s = shapesFor(g, 'sensitive', a1, board);
		expect(s.length).toBeGreaterThan(0);
		expect(s.every((x) => x.dest === undefined)).toBe(true);
	});

	it('separates the colours', () => {
		const both = build(at('r6k/8/8/8/8/8/8/R3K3 w - - 0 1').board);
		const bb = at('r6k/8/8/8/8/8/8/R3K3 w - - 0 1').board;
		const brushes = new Set(shapesFor(both, 'attacks', undefined, bb).map((x) => x.brush));
		expect(brushes.size).toBe(2);
	});

	it('focusing shows one piece, unfocused shows the board', () => {
		expect(shapesFor(g, 'all', a1, board).length).toBeLessThan(shapesFor(g, 'all', undefined, board).length);
	});
});

describe('the sentence beside the board', () => {
	it('counts live edges and names what it sees through', () => {
		expect(read(g, a1, board)).toBe('bears on 5 squares and on 9 more through a2, e1');
	});
	it('says nothing about an empty square', () => {
		expect(read(g, parseSquare('d5'), board)).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Motifs — PLAN-OVERLAY.md.
//
// Every expectation below was read off a probe first. Twice in this file already
// I wrote one from the armchair and it was wrong, the second time because I had
// not read output I had myself produced.
// ---------------------------------------------------------------------------

describe('motifs the graph already knows', () => {
	const kinds = (fen: string) => {
		const p = at(fen);
		return motifsIn(build(p.board), p.board);
	};
	const named = (m: ReturnType<typeof kinds>) =>
		m.map((x) =>
			x.kind === 'pin'
				? `pin${x.absolute ? '!' : '?'}:${makeSquare(x.blocker)}`
				: x.kind === 'potentialPin'
					? `pot:${makeSquare(x.blocker)}`
					: `${x.kind}:${makeSquare(x.square)}`,
		);

	// White rook e1 (defended by Kf1), black rook e5, black king e8.
	// Every value below came off scripts/motifprobe.mjs, not out of my head.
	const contested = kinds('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');

	it('calls a square both sides bear on an exchange', () => {
		expect(named(contested)).toContain('exchange:e1');
	});

	// "Undefended", never "hanging". Whether it is actually lost is an exchange,
	// and this layer has not computed one — that is the ledger's job.
	it('calls a piece only the enemy bears on undefended', () => {
		expect(named(contested)).toContain('undefended:e5');
	});

	it('finds an absolute pin, and calls it absolute', () => {
		expect(named(kinds('4k3/8/8/4n3/8/8/8/4RK2 w - - 0 1'))).toContain('pin!:e5');
	});

	it('finds a relative pin when the piece behind is merely dearer', () => {
		expect(named(kinds('4q2k/8/8/4n3/8/8/8/4RK2 w - - 0 1'))).toContain('pin?:e5');
	});

	// A piece in front of its OWN king or queen is a battery, not a pin. Getting
	// this backwards would paint half of every board violet.
	it('does not call a friendly shield a pin', () => {
		const m = kinds('4q2k/8/8/4r3/8/8/8/K7 w - - 0 1');
		expect(m.filter((x) => x.kind === 'pin')).toEqual([]);
	});

	it('sees an alignment nobody is exploiting yet', () => {
		expect(named(kinds('4q2k/8/8/4n3/8/8/8/5K2 w - - 0 1'))).toContain('pot:e5');
	});

	// Alignments are common enough to be meaningless unfiltered — a rook beside a
	// castled king is one. They draw only for the focused piece.
	it('draws potential pins only when focused', () => {
		const p = at('4q2k/8/8/4n3/8/8/8/5K2 w - - 0 1');
		const g = build(p.board);
		const unfocused = shapesFor(g, 'motifs', null, p.board);
		const focused = shapesFor(g, 'motifs', parseSquare('e5'), p.board);
		expect(focused.length).toBeGreaterThan(unfocused.length);
	});
});
