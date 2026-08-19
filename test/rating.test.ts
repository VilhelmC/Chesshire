import { describe, it, expect } from 'vitest';
import { eloFromAcpl, estimate, levelFor, BOT_LEVELS, MIN_SAMPLE } from '../src/domain/rating';
import { freeplayLosses, type AnswerRow } from '../src/domain/progress';

describe('elo from centipawn loss', () => {
	it('is monotonically decreasing', () => {
		const acpls = [10, 20, 35, 50, 75, 100, 150, 250, 400];
		const elos = acpls.map(eloFromAcpl);
		for (let i = 1; i < elos.length; i++) expect(elos[i]).toBeLessThan(elos[i - 1]);
	});

	it('interpolates between anchors', () => {
		const mid = eloFromAcpl(27.5); // halfway between 20 and 35
		expect(mid).toBeGreaterThan(eloFromAcpl(35));
		expect(mid).toBeLessThan(eloFromAcpl(20));
	});

	it('clamps outside the anchor range', () => {
		expect(eloFromAcpl(0)).toBe(eloFromAcpl(10));
		expect(eloFromAcpl(5000)).toBe(eloFromAcpl(400));
	});
});

describe('estimate', () => {
	it('reports no estimate without data', () => {
		const e = estimate([]);
		expect(e.elo).toBeNull();
		expect(e.confident).toBe(false);
	});

	it('withholds confidence until the sample is big enough', () => {
		expect(estimate([50, 50, 50]).confident).toBe(false);
		expect(estimate(Array(MIN_SAMPLE).fill(50)).confident).toBe(true);
	});

	it('caps a single catastrophe so it cannot dominate', () => {
		// The usual complaint about raw ACPL: one hung queen swamps twenty
		// accurate moves and the estimate collapses.
		const withDisaster = estimate([...Array(19).fill(20), 5000]);
		const withCapped = estimate([...Array(19).fill(20), 600]);
		expect(withDisaster.acpl).toBe(withCapped.acpl);
	});

	it('rates accurate play higher than sloppy play', () => {
		const good = estimate(Array(20).fill(15));
		const sloppy = estimate(Array(20).fill(120));
		expect(good.elo!).toBeGreaterThan(sloppy.elo!);
	});
});

describe('what counts towards the estimate', () => {
	function ans(phase: AnswerRow['phase'], cpLoss: number): AnswerRow {
		return {
			id: Math.random().toString(),
			ts: 0,
			runId: 'r',
			path: ['e4', 'e5'],
			ply: 0,
			phase,
			correct: true,
			revealed: false,
			assisted: false,
			cpLoss,
		};
	}

	it('uses free play only', () => {
		// Recalling a memorised repertoire move measures memory. Counting it as
		// strength would show the rating climbing every time you revised.
		const rows = [ans('book', 0), ans('book', 0), ans('punish', 0), ans('freeplay', 80)];
		expect(freeplayLosses(rows)).toEqual([80]);
	});
});

describe('bot levels', () => {
	it('gets stronger as the level rises', () => {
		for (let i = 1; i < BOT_LEVELS.length; i++) {
			expect(BOT_LEVELS[i].elo).toBeGreaterThan(BOT_LEVELS[i - 1].elo);
			// Strength comes from narrowing the candidate window, not from a
			// crippled search — a shallow engine plays incoherently instead of weakly.
			expect(BOT_LEVELS[i].window).toBeLessThan(BOT_LEVELS[i - 1].window);
			expect(BOT_LEVELS[i].movetimeMs).toBeGreaterThan(BOT_LEVELS[i - 1].movetimeMs);
		}
	});

	it('picks a beatable rung for a known rating', () => {
		const l = levelFor(1400);
		expect(l.elo).toBeLessThanOrEqual(1500);
	});

	it('falls back to a modest default when nothing is known', () => {
		const l = levelFor(null);
		expect(l.elo).toBeLessThanOrEqual(1200);
	});
});

describe('piece glyphs', () => {
	it('maps SAN to the piece that moved', async () => {
		const { glyphForSan } = await import('../src/engine/candidates');
		expect(glyphForSan('Nxe5', 'w')).toBe('♘');
		expect(glyphForSan('Bc4', 'w')).toBe('♗');
		expect(glyphForSan('Qh5+', 'w')).toBe('♕');
		expect(glyphForSan('Rae1', 'w')).toBe('♖');
		// A pawn move has no leading letter.
		expect(glyphForSan('exd5', 'w')).toBe('♙');
		expect(glyphForSan('e4', 'w')).toBe('♙');
		// Castling is a king move, not a nonexistent "O" piece.
		expect(glyphForSan('O-O', 'w')).toBe('♔');
		expect(glyphForSan('O-O-O', 'b')).toBe('♚');
	});

	it('uses the moving side’s glyphs', async () => {
		const { glyphForSan } = await import('../src/engine/candidates');
		expect(glyphForSan('Nf6', 'b')).toBe('♞');
	});
});

describe('grade ramp', () => {
	it('gives the board and the list the same colour', async () => {
		const { brushForGrade, colourForGrade, GRADE_COLOURS } = await import(
			'../src/engine/candidates'
		);
		// A legend whose colours drift from the marks it explains is worse than
		// no legend, so both come from one table.
		for (const g of [0, 0.25, 0.5, 0.75, 1]) {
			const step = Number(brushForGrade(g).slice(1));
			expect(colourForGrade(g)).toBe(GRADE_COLOURS[step]);
		}
	});

	it('never runs off the end of the ramp', async () => {
		const { brushForGrade } = await import('../src/engine/candidates');
		expect(brushForGrade(1)).toBe('q4');
		expect(brushForGrade(99)).toBe('q4');
	});
});
