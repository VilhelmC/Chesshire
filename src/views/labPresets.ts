// Numbered positions whose answer is known — and checked by an engine, not by me.
//
// Four rules, each learned by getting it wrong.
//
// **The pieces are NOT in place.** Every earlier set had the rook already on the
// file and the pawns already attacking and defending, which reduces the whole
// exercise to an exchange count — the thing SEE has done since the 1970s. The
// question this project exists to ask is the one BEFORE the knot forms: who can
// reach it, in how many moves, and what does the other side do with the same
// tempi. A fixture with everything in place cannot ask it.
//
// **Kings get a shelter.** A bare king hands the defender resources no real
// position offers. A sparse board is not a simplified board, it is a different
// game.
//
// **Material is balanced**, so the engine's evaluation is about the tactic
// rather than about an imbalance I left lying around.
//
// **The claim comes from the engine.** Every `claim` was set by running
// Stockfish; `test/adjudicate.test.ts` re-checks them. My own reasoning has been
// wrong about this material repeatedly, and a fixture whose expected answer is
// my opinion is worth nothing.

export type Preset = {
	/** Stable number, so a position can be referred to in one word. */
	n: number;
	name: string;
	fen: string;
	target: string;
	/** What the position is for, in one line, for a reader at the board. */
	expect: string;
	/** Set by the engine: does the attacking side win material here? */
	claim?: 'wins' | 'nothing';
	/** The engine's evaluation when the claim was recorded, depth 18. */
	engine?: string;
};

export const PRESETS: Preset[] = [
	{
		n: 1,
		name: 'Everything already in place',
		fen: '1r1q2k1/1p3ppp/4p3/3n4/8/N7/1P2PPPP/Q2R2K1 w - - 0 1',
		target: 'd5',
		expect:
			'The baseline, and deliberately the dull one: rook already on the file, pawn already on e6. This is an exchange count and nothing more — SEE answers it. Every other position here asks the question this one cannot.',
		claim: 'wins',
		engine: '+451, best move e2e4',
	},
	{
		n: 2,
		name: 'Rook must commit first',
		fen: '1r1q2k1/1p3ppp/4p3/3n4/8/N7/1P2PPPP/Q4RK1 w - - 0 1',
		target: 'd5',
		expect:
			'The rook is on f1. Committing it to d1 costs a tempo — and the knight can spend that same tempo leaving. Is the plan worth starting?',
		claim: 'nothing',
		engine: '−3, best move Rf1–d1',
	},
	{
		n: 3,
		name: 'Neither side is in place',
		fen: '1r1q2k1/1p2pppp/8/3n4/8/N7/1P2PPPP/Q4RK1 w - - 0 1',
		target: 'd5',
		expect:
			'Rook on f1, pawn on e2, and Black’s e-pawn still on e7 where it can come to e6 to defend. Two tempi each: a race, not a count.',
		claim: 'nothing',
		engine: '+0, best move Rf1–d1',
	},
	{
		n: 4,
		name: 'Nothing can defend it',
		fen: '1r1q2k1/pp3ppp/8/3n4/8/N7/1P2PPPP/Q4RK1 w - - 0 1',
		target: 'd5',
		expect:
			'Same, but Black has no pawn that can ever reach e6 or c6. The knight has to run, and the rook committing to d1 is what stops it.',
		claim: 'nothing',
		engine: '+2, best move Rf1–d1',
	},
	{
		n: 5,
		name: 'No attacker within reach',
		fen: '1r1q2k1/1p2pppp/8/3n4/8/N7/PP3PPP/Q4RK1 w - - 0 1',
		target: 'd5',
		expect:
			'No pawn on the e-file at all, so there is no second attacker to bring. Whatever the rook does, the count never turns — and saying so is the half a motif drill never shows.',
		claim: 'nothing',
		engine: '−13',
	},
	{
		n: 6,
		name: 'A defender with a prior job',
		fen: '6nk/1b3p1p/4p2b/3n4/8/7N/1P2P1BP/1NB3K1 w - - 0 1',
		target: 'd5',
		expect:
			'White can add an attacker; Black can add the knight on g8, which is the only guard of h6. The DUTY is computed correctly here (330 at h6, and there is a test for it) — but this position does not currently produce an “entangled” verdict, because the exchange count already favours White at k = 1 and the race stops for a different reason. The mechanism is real; this fixture does not yet demonstrate it.',
		claim: 'nothing',
		engine: '+13',
	},
	{
		n: 7,
		name: 'The knight is not pinned — it checks',
		fen: '1r1q2k1/pp3pp1/4p3/3n4/8/7N/P1PR1PPP/1K1Q4 w - - 0 1',
		target: 'd5',
		expect:
			'Every static count says the knight is pinned to the queen. It has Nc3+ — check first, so the exposure behind it is never collected.',
		claim: 'nothing',
		engine: '−369',
	},
];
