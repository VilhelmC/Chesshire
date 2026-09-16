// Every legal move, graded.
//
// Powers the "show me the options" hint: rather than revealing one move, draw
// the whole choice with the good ones loud and the bad ones faint. Seeing that
// three moves are nearly as good, and one is a disaster, is a different and more
// useful lesson than being told the answer.

import { analysePosition, toColourPov } from '../data/cloudEval';
import { applyUci } from '../domain/chess';

export type Candidate = {
	uci: string;
	san: string;
	/** Centipawns from our point of view after the move. */
	cp: number;
	/** How far behind the best move, in centipawns. */
	loss: number;
	/** 0 = best, 1 = worst shown. Drives arrow weight and colour. */
	grade: number;
};

/**
 * Rank the engine's top moves.
 *
 * MultiPV, so this always runs locally — the Lichess cloud stores one principal
 * variation. A short movetime is fine: separating a good move from a blunder
 * does not need depth 30.
 */
export async function candidateMoves(
	fen: string,
	ourColour: 'w' | 'b',
	count = 5,
	movetimeMs = 400,
): Promise<Candidate[]> {
	const a = await analysePosition(fen, 12, count, movetimeMs);

	const rows = a.pvs
		.filter((p) => p.pv.length)
		.map((p) => ({ uci: p.pv[0], cp: toColourPov(p.cpWhite, ourColour) }))
		.sort((x, y) => y.cp - x.cp);
	if (!rows.length) return [];

	const best = rows[0].cp;
	// Grade against the spread actually on the board. Scaling to a fixed range
	// would make every position look the same, when the useful signal is whether
	// this particular choice is close or wide.
	const worstLoss = Math.max(1, best - rows[rows.length - 1].cp);

	return rows.map((r) => {
		let san = r.uci;
		try {
			san = applyUci(fen, r.uci).san;
		} catch {
			/* keep the uci */
		}
		const loss = best - r.cp;
		return { uci: r.uci, san, cp: r.cp, loss, grade: Math.min(1, loss / worstLoss) };
	});
}

/** Arrow brush for a graded candidate — see Board's registered brushes. */
export function brushForGrade(grade: number): string {
	return `q${gradeStep(grade)}`;
}

export function gradeStep(grade: number): number {
	return Math.min(4, Math.floor(grade * 5));
}

/**
 * The same five colours the board draws with.
 *
 * Exported rather than duplicated in the view: a legend whose colours drift from
 * the marks it explains is worse than no legend.
 */
/**
 * The swatch beside a move in a list, and the arrow drawn for it on the board,
 * are the same ramp — see `QUALITY_BRUSHES` in `components/Board.tsx` for why
 * it is batlow and why it stops at 0.45. Two copies of five hex values is not
 * ideal; one of them being a DIFFERENT five would be worse, and that is what a
 * reader would otherwise have to reconcile.
 */
export const GRADE_COLOURS = ['#011959', '#103f60', '#1c5a62', '#3e6e55', '#6c7c3c'];

export function colourForGrade(grade: number): string {
	return GRADE_COLOURS[gradeStep(grade)];
}

/**
 * Piece glyph for a SAN move.
 *
 * Shown beside the notation so the eye can sort the list by piece without
 * decoding letters first. Every translation step between symbol and meaning is
 * one the learner pays for, and this one is free to remove.
 */
export { glyphForSan } from '../domain/notation';
