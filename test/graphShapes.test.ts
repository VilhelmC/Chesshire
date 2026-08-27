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
import { shapesFor, motifsIn, describe as read, explainCover, explainCouplings } from '../src/domain/graphShapes';
import { gamma, concede, classify2 } from '../src/domain/cover2';

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

// ---------------------------------------------------------------------------
// PLAN.md's overlay table, rows M3 and M4: obligation badges carrying w and τ,
// and Γ drawn as obligation → discharging move. Both were owed and neither was
// built when the milestones closed.
//
// A wrong overlay is worse than none — it is a confident diagram of something
// that is not happening, and it will be trusted because it is visual. So these
// assert the shapes against the Γ they claim to draw.
// ---------------------------------------------------------------------------
describe('the ledger and Γ, drawn', () => {
	// A knight attacked by a pawn, and the same pawn racing to promote. Two rows
	// with different deadlines on one board, which is what the layer is for.
	const POS = at('4k3/8/8/8/1n6/P7/8/4K3 b - - 0 1');
	const gr = build(POS.board);
	const gam = gamma(POS, { owed: 'black' });

	it('badges every obligation with its weight in pawns and its deadline', () => {
		const s = shapesFor(gr, 'owed', null, POS.board, gam);
		const badges = Object.fromEntries(s.filter((x) => x.label).map((x) => [x.orig, x.label]));
		expect(badges['b4']).toBe('3/1'); // a knight, due now
		expect(badges['a8']).toBe('8/5'); // a queen's worth, five tempi out
		// No arrows on this layer: an obligation is a fact ABOUT a square, and an
		// arrow would invent a direction it does not have.
		expect(s.every((x) => x.dest === undefined)).toBe(true);
	});

	it('reads check as # rather than printing Infinity in a 40-pixel box', () => {
		const p = at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1');
		const gm = gamma(p, { owed: 'white' });
		const s = shapesFor(build(p.board), 'owed', null, p.board, gm);
		expect(s.find((x) => x.orig === 'e1')?.label).toBe('#');
		expect(s.find((x) => x.orig === 'a1')?.label).toBe('5/1');
	});

	// Drawn from the discharging piece TO the required square — the direction the
	// move goes. The picture is then the move you would play.
	it('draws one arrow per discharge, from the piece that supplies it', () => {
		const s = shapesFor(gr, 'cover', null, POS.board, gam);
		const arrows = s.filter((x) => x.dest);
		expect(arrows.length).toBe(gam.edges.length);
		for (const e of gam.edges) {
			const drawn = arrows.find((x) => x.orig === makeSquare(e.piece) && x.dest === makeSquare(e.to));
			expect(drawn, `${e.kind} ${makeSquare(e.piece)}->${makeSquare(e.to)} not drawn`).toBeDefined();
			// A cover needing more than one tempo is faint, exactly as a blocked
			// x-ray is: real, and visibly not acting.
			expect(drawn!.brush.endsWith('X')).toBe(e.cost > 1);
		}
	});

	it('rings an obligation nothing can reach in time, since an absence is not an arrow', () => {
		const p = at('8/P7/8/8/8/6k1/8/6K1 b - - 0 1');
		const gm = gamma(p, { owed: 'black' });
		expect(gm.coverable).toEqual([false]);
		const s = shapesFor(build(p.board), 'cover', null, p.board, gm);
		expect(s.some((x) => x.orig === 'a8' && x.brush === 'gUncovered')).toBe(true);
	});

	it('shows only what the focused piece is involved in', () => {
		const knight = parseSquare('b4');
		const s = shapesFor(gr, 'cover', knight, POS.board, gam).filter((x) => x.dest);
		// Either the knight supplies the discharge, or the obligation is its own.
		for (const x of s) expect(x.orig).toBe('b4');
		expect(s.length).toBeLessThan(gam.edges.length);
	});
});

describe('the sentence Γ produces', () => {
	// §4's argmin and the `e` it leaves: "this is your best move, and this is
	// what it still costs you." Available because the computation held the nouns.
	// The renderer is injected, so the sentence can wear the house figurine style
	// in the app while the tests read squares. DETECTOR.md §6.
	it('lets the caller supply the move notation', () => {
		const p = at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1');
		const gm = gamma(p, { owed: 'white' });
		const note = explainCover(gm, classify2(gm, p.board, 'white'), concede(p, gm, 'white'), () => 'THEMOVE');
		expect(note).toContain('best is THEMOVE');
	});

	it('names the cost when no move answers everything', () => {
		const p = at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1');
		const gm = gamma(p, { owed: 'white' });
		const note = explainCover(gm, classify2(gm, p.board, 'white'), concede(p, gm, 'white'));
		expect(note).toContain('no move answers all of them');
		expect(note).toContain('a1');
	});

	it('says the answer arrives late rather than that there is none', () => {
		const p = at('8/P7/8/8/8/6k1/8/6K1 b - - 0 1');
		const gm = gamma(p, { owed: 'black' });
		const note = explainCover(gm, classify2(gm, p.board, 'black'), concede(p, gm, 'black'));
		expect(note).toContain('arrives late');
		expect(note).toContain('a8');
	});

	it('says nothing is owed when nothing is', () => {
		const p = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		const gm = gamma(p, { owed: 'white' });
		expect(explainCover(gm, classify2(gm, p.board, 'white'), concede(p, gm, 'white'))).toBe('nothing owed');
	});
});

// ---------------------------------------------------------------------------
// PLAN.md M5's overlay row: "the contested piece linked to both its duties."
// §6.6's argument is that a tree over couplings ANNOTATES and a tree over plies
// does not — so the picture is the branch structure itself.
// ---------------------------------------------------------------------------
describe('couplings, drawn', () => {
	// A king holding two pawns a knight attacks: one piece, two duties.
	const OVER = at('4k3/8/8/8/2n5/8/1P1P4/2K5 b - - 0 1');

	it('fans out from the piece that cannot be in two places', () => {
		const s = shapesFor(build(OVER.board), 'couplings', null, OVER.board);
		const arrows = s.filter((x) => x.dest && x.brush === 'gTwoJobs');
		expect(arrows.map((x) => x.orig)).toEqual(['c1', 'c1']);
		expect(arrows.map((x) => x.dest).sort()).toEqual(['b2', 'd2']);
		// And the piece itself is badged with what leaving costs, in pawns.
		expect(s.find((x) => x.orig === 'c1' && !x.dest)?.label).toBe('2');
	});

	it('draws every exchange square, so a coupling reads as a relation', () => {
		const s = shapesFor(build(OVER.board), 'couplings', null, OVER.board);
		const faint = s.filter((x) => x.brush === 'gChain').map((x) => x.orig).sort();
		expect(faint).toEqual(['b2', 'd2']);
	});

	it('says the values simply add when nothing is coupled', () => {
		// §6.1's claim, and worth saying out loud rather than leaving the board
		// blank: four chains, no tree.
		const board = at('r6r/8/4k3/8/8/8/8/RR3KRR w - - 0 1').board;
		expect(explainCouplings(board)).toBe('4 exchanges, none coupled — the values simply add');
	});

	it('names the overloaded piece first, ranked by what ignoring it costs', () => {
		expect(explainCouplings(OVER.board)).toBe('the king on c1 cannot hold b2 and d2 at once — 200');
	});

	// Ranked by what ignoring one costs. A mutation audit dropped the sort and no
	// test moved, because every position I had picked carried one coupling — so
	// this uses Uqazm, which carries two of different weight: the king overloaded
	// on g7+h7 (200) and the f7 exchange opening c6 (100). Unranked, the smaller
	// one is reported first purely because resolutions are pushed first.
	it('reports the costliest coupling first, not the first one found', () => {
		const p = at('r2q2k1/p1pb1Rpp/2p5/3pr1PQ/3N4/2P5/P1P3PP/R5K1 b - - 0 16').clone();
		p.play({ from: parseSquare('d7'), to: parseSquare('e8') });
		expect(explainCouplings(p.board, 1)).toContain('cannot hold g7 and h7');
		// Both are still there at limit 2, in order.
		const both = explainCouplings(p.board, 2)!;
		expect(both.indexOf('g7 and h7')).toBeLessThan(both.indexOf('c6'));
	});

	it('has nothing to say about a board with no exchanges', () => {
		expect(explainCouplings(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBeNull();
	});
});
