import { describe, it, expect } from 'vitest';
import { LINES } from '../src/domain/lines';
import { playSanLine, applyUci, sideToMove, INITIAL_FEN } from '../src/domain/chess';

// These lines no longer drive training (see src/domain/lines.ts) — they name
// old history and seed the drill-research tab. Still hand-written, so still
// worth parsing: a typo here would name a run after a line that does not exist.
describe('legacy lines', () => {
	for (const line of LINES) {
		it(`${line.name} is legal from move 1`, () => {
			expect(() => playSanLine(line.moves)).not.toThrow();
		});

		it(`${line.name} has positions for both sides to be quizzed on`, () => {
			const { ucis } = playSanLine(line.moves);
			let fen = INITIAL_FEN;
			const toMove: string[] = [];
			for (const uci of ucis) {
				toMove.push(sideToMove(fen));
				fen = applyUci(fen, uci).fen;
			}
			// Book drills need our moves; deviation drills need theirs.
			expect(toMove).toContain(line.colour);
			expect(toMove).toContain(line.colour === 'w' ? 'b' : 'w');
		});

		it(`${line.name} is long enough to be worth drilling`, () => {
			expect(playSanLine(line.moves).ucis.length).toBeGreaterThanOrEqual(7);
		});
	}

	it('has unique ids', () => {
		expect(new Set(LINES.map((l) => l.id)).size).toBe(LINES.length);
	});

	it('reaches the Fried Liver position it claims to teach', () => {
		const fl = LINES.find((l) => l.id === 'two-knights-friedliver')!;
		const { ucis } = playSanLine(fl.moves);
		// 6.Nxf7 is the point of the line — it must actually appear.
		let fen = INITIAL_FEN;
		const sans: string[] = [];
		for (const uci of ucis) {
			const r = applyUci(fen, uci);
			sans.push(r.san);
			fen = r.fen;
		}
		expect(sans).toContain('Nxf7');
	});
});
