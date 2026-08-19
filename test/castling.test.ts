import { describe, it, expect } from 'vitest';
import { applySan, applyUci, sameMove, playSanLine, replayLine } from '../src/domain/chess';

// Castling has two UCI spellings. Chessground, the Lichess explorer and
// Stockfish all say `e1g1`; chessops says `e1h1` (king takes rook, the form
// that survives Chess960). `applySan` returned the chessops one, so any
// expected move built from SAN rejected a castle dragged on the board — which
// looks exactly like the board refusing to let you move.
const WHITE_CAN_CASTLE = 'r1bqk2r/ppp2ppp/2n2n2/3p4/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQkq - 0 9';
const BOTH_SIDES = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('applySan produces the spelling everything else uses', () => {
	it('kingside, white', () => {
		expect(applySan(WHITE_CAN_CASTLE, 'O-O').uci).toBe('e1g1');
	});

	it('queenside, white', () => {
		expect(applySan(BOTH_SIDES, 'O-O-O').uci).toBe('e1c1');
	});

	it('both sides, black', () => {
		const black = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
		expect(applySan(black, 'O-O').uci).toBe('e8g8');
		expect(applySan(black, 'O-O-O').uci).toBe('e8c8');
	});

	it('leaves ordinary moves alone', () => {
		expect(applySan(WHITE_CAN_CASTLE, 'a3').uci).toBe('a2a3');
		expect(applySan(WHITE_CAN_CASTLE, 'Bg5').uci).toBe('c1g5');
	});

	it('still produces a position that plays on', () => {
		const after = applySan(WHITE_CAN_CASTLE, 'O-O').fen;
		expect(after).toContain('R1BQ1RK1');
	});

	it('keeps whole lines consistent', () => {
		const { ucis } = playSanLine('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O');
		expect(ucis[ucis.length - 1]).toBe('e1g1');
	});

	it('is what replayLine reports too, so move-list previews agree', () => {
		const line = replayLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
		expect(line[7].uci).toBe('e1g1');
	});
});

describe('sameMove', () => {
	it('accepts either spelling of a castle', () => {
		expect(sameMove(WHITE_CAN_CASTLE, 'e1g1', 'e1h1')).toBe(true);
		expect(sameMove(WHITE_CAN_CASTLE, 'e1h1', 'e1g1')).toBe(true);
	});

	it('accepts either spelling queenside', () => {
		expect(sameMove(BOTH_SIDES, 'e1c1', 'e1a1')).toBe(true);
	});

	it('does not conflate the two castling sides', () => {
		expect(sameMove(BOTH_SIDES, 'e1g1', 'e1c1')).toBe(false);
	});

	it('is still exact for ordinary moves', () => {
		expect(sameMove(WHITE_CAN_CASTLE, 'a2a3', 'a2a3')).toBe(true);
		expect(sameMove(WHITE_CAN_CASTLE, 'a2a3', 'a2a4')).toBe(false);
	});

	it('handles a position where the king move is not a castle at all', () => {
		// King on e1 with no rights: e1g1 is not legal and not a castle.
		const noRights = 'r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1';
		expect(sameMove(noRights, 'e1f1', 'e1d1')).toBe(false);
	});

	it('says no rather than throwing on nonsense', () => {
		expect(sameMove('not a fen', 'e1g1', 'e1h1')).toBe(false);
		expect(sameMove(WHITE_CAN_CASTLE, 'zzzz', 'e1g1')).toBe(false);
	});
});

describe('both spellings remain playable', () => {
	it('so a card stored with the old one can still be applied', () => {
		expect(applyUci(WHITE_CAN_CASTLE, 'e1g1').san).toBe('O-O');
		expect(applyUci(WHITE_CAN_CASTLE, 'e1h1').san).toBe('O-O');
	});
});
