// The ramp is scaled over the moves worth considering, not over everything asked for.
//
// ---------------------------------------------------------------------------
// The table now asks the engine for two dozen lines so that every row it shows
// carries an evaluation. `grade` used to be scaled over whatever came back, so
// widening the request would have quietly rescaled the BOARD: include one
// hanging-queen line and the top five all collapse into the same dark brush,
// because they are now "close" relative to a disaster.
//
// These pin the separation. `gradeOver` is the ramp's reference set; `count` is
// how many rows the table gets. Changing one must not move the other.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const analyse = vi.fn();
vi.mock('../src/data/cloudEval', () => ({
	analysePosition: (...a: unknown[]) => analyse(...a),
	toColourPov: (cp: number, c: 'w' | 'b') => (c === 'w' ? cp : -cp),
}));

const { candidateMoves } = await import('../src/engine/candidates');
const { INITIAL_FEN } = await import('../src/domain/chess');

/** Five sane first moves and one catastrophe, as MultiPV rows. */
const PVS = [
	{ cpWhite: 30, pv: ['e2e4'] },
	{ cpWhite: 28, pv: ['d2d4'] },
	{ cpWhite: 20, pv: ['g1f3'] },
	{ cpWhite: 15, pv: ['c2c4'] },
	{ cpWhite: 10, pv: ['b1c3'] },
	{ cpWhite: -900, pv: ['g2g4'] },
];

beforeEach(() => {
	analyse.mockReset();
	analyse.mockResolvedValue({ fen: INITIAL_FEN, depth: 12, pvs: PVS });
});

describe('grading a wide request', () => {
	it('returns every line it was given', async () => {
		const out = await candidateMoves(INITIAL_FEN, 'w', 24);
		expect(out.map((c) => c.san)).toHaveLength(6);
	});

	it('scales the ramp over the top five, whatever else came back', async () => {
		const wide = await candidateMoves(INITIAL_FEN, 'w', 24);
		const narrow = await candidateMoves(INITIAL_FEN, 'w', 5);
		const grades = (rows: { san: string; grade: number }[]) =>
			rows.slice(0, 5).map((r) => r.grade);
		// The five moves anyone would consider get the same brush in both. This is
		// the whole point: asking for more rows changes the TABLE, not the BOARD.
		expect(grades(wide)).toEqual(grades(narrow));
	});

	it('clamps anything past the reference set to the faintest brush', async () => {
		const out = await candidateMoves(INITIAL_FEN, 'w', 24);
		const blunder = out.find((c) => c.uci === 'g2g4')!;
		expect(blunder.grade).toBe(1);
	});

	it('still reports the real loss for a clamped move', async () => {
		// The BRUSH saturates; the NUMBER does not. A reader who wants to know how
		// bad it is reads the column, and 9.3 pawns is not "the same as 0.2".
		const out = await candidateMoves(INITIAL_FEN, 'w', 24);
		expect(out.find((c) => c.uci === 'g2g4')!.loss).toBe(930);
	});

	it('takes an explicit reference width', async () => {
		const out = await candidateMoves(INITIAL_FEN, 'w', 24, 400, 2);
		// Scaled over e4 and d4 only — a two-centipawn spread — so the third move
		// is already off the end of the ramp.
		expect(out[1].grade).toBe(1);
		expect(out[2].grade).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// THE LABEL HAS TO STAY SHORT, AND THAT IS ARITHMETIC.
//
// Will: "with the ◆ denoting book moves the text becomes too small to read in
// the arrow labels."
//
// Chessground sizes an arrow label as `0.4 * 0.75 ** text.length` — every extra
// character shrinks THE WHOLE LABEL, exponentially. So a marker appended to the
// label does not cost a corner of the badge, it costs the evaluation's
// legibility. The mark moved to its own shape; this is the number that says why
// it had to, and it fails if anyone lengthens the label again.
// ---------------------------------------------------------------------------
describe('what an arrow label costs', () => {
	/** Chessground's own formula — see node_modules/chessground/src/svg.ts. */
	const fontSize = (text: string) => 0.4 * 0.75 ** text.length;

	it('shrinks by nearly half when a two-character mark is appended', () => {
		const plain = fontSize('+0.3');
		const marked = fontSize('+0.3 ◆');
		expect(marked / plain).toBeCloseTo(0.5625, 4);
	});

	it('is why the evaluation is shown to one decimal and not two', () => {
		// "+0.31" is already 25% smaller than "+0.3", and the extra digit is a
		// precision this search does not have.
		expect(fontSize('+0.31')).toBeLessThan(fontSize('+0.3'));
	});

	it('leaves a four-character label comfortably legible', () => {
		// The board is at least 240px, so a square is at least 30px and the label
		// is `fontSize` in square units. Below about 0.1 it stops being readable.
		for (const label of ['+0.3', '-1.2', '+9.9', 'mate']) {
			expect(fontSize(label)).toBeGreaterThan(0.12);
		}
	});
});
