// Thin helpers over chessops. Kept in one place so FEN/UCI/SAN conversions are
// consistent everywhere (this is exactly the sort of thing that silently rots).

import { Chess } from 'chessops/chess';
import { parseFen, makeFen, INITIAL_FEN } from 'chessops/fen';
import { parseUci, makeUci, parseSquare, makeSquare } from 'chessops/util';
import { normalizeMove, castlingSide } from 'chessops/chess';
import { makeSan, parseSan } from 'chessops/san';
import { chessgroundDests } from 'chessops/compat';
import type { Move } from 'chessops/types';
import type { PositionKey } from './types';

export { INITIAL_FEN, Chess, chessgroundDests };

export function positionFromFen(fen: string): Chess {
	const setup = parseFen(fen).unwrap();
	return Chess.fromSetup(setup).unwrap();
}

export function fenOf(pos: Chess): string {
	return makeFen(pos.toSetup());
}

/**
 * Normalised position key: FEN without the halfmove clock and fullmove number.
 * Two positions that differ only in move counters are the same training node.
 */
export function positionKey(fen: string): PositionKey {
	return fen.split(' ').slice(0, 4).join(' ');
}

export function applyUci(fen: string, uci: string): { fen: string; san: string } {
	const pos = positionFromFen(fen);
	const move = parseUci(uci);
	if (!move || !pos.isLegal(move)) throw new Error(`Illegal move ${uci} in ${fen}`);
	const san = makeSan(pos, move);
	pos.play(move);
	return { fen: fenOf(pos), san };
}

export function applySan(fen: string, san: string): { fen: string; uci: string } {
	const pos = positionFromFen(fen);
	const move = parseSan(pos, san);
	if (!move) throw new Error(`Illegal SAN ${san} in ${fen}`);
	const uci = standardUci(pos, move);
	pos.play(move);
	return { fen: fenOf(pos), uci };
}

/**
 * UCI in the form everything else in this app speaks.
 *
 * ---------------------------------------------------------------------------
 * Castling has two spellings and chessops uses the one nothing else here does.
 * Internally a castle is KING TAKES ROOK — `e1h1` — because that is the form
 * that survives Chess960. Chessground reports `e1g1`, the Lichess explorer
 * returns `e1g1`, and Stockfish prints `e1g1`.
 *
 * So `applySan(fen, 'O-O').uci` was `e1h1` while the board reported `e1g1`, and
 * every place that builds an expected move from SAN and then compares strings
 * rejected castling: you drag the king, nothing matches, the board snaps back.
 * It reads exactly like the board refusing the move.
 *
 * One spelling, chosen to be the one three of the four sources already use.
 * ---------------------------------------------------------------------------
 */
function standardUci(pos: Chess, move: Move): string {
	if (!('from' in move)) return makeUci(move);
	const side = castlingSide(pos, move);
	if (!side) return makeUci(move);
	const from = makeSquare(move.from);
	return `${from}${side === 'h' ? 'g' : 'c'}${from[1]}`;
}

/**
 * Are these two UCI strings the same move in this position?
 *
 * String equality is not enough for castling — see above — and cards written
 * before this was fixed still hold the `e1h1` spelling, so comparison has to
 * stay tolerant of both rather than relying on everything being rewritten.
 */
export function sameMove(fen: string, a: string, b: string): boolean {
	if (a === b) return true;
	try {
		const pos = positionFromFen(fen);
		const ma = parseUci(a);
		const mb = parseUci(b);
		if (!ma || !mb) return false;
		return makeUci(normalizeMove(pos, ma)) === makeUci(normalizeMove(pos, mb));
	} catch {
		return false;
	}
}

/** Play a space-separated SAN line (e.g. "e4 e5 Nf3 Nc6 Bc4") from a FEN. */
export function playSanLine(line: string, from = INITIAL_FEN): { fen: string; ucis: string[] } {
	const sans = line
		.replace(/\d+\.(\.\.)?/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	let fen = from;
	const ucis: string[] = [];
	for (const san of sans) {
		const r = applySan(fen, san);
		fen = r.fen;
		ucis.push(r.uci);
	}
	return { fen, ucis };
}

/**
 * Every position a line passes through.
 *
 * Index i is the position AFTER i plies, so `replayLine(path)[0]` is the start.
 * Stops at the first move that will not play rather than throwing, so a
 * half-valid path still yields the part of it that is real.
 *
 * This exists because a position is fully determined by the moves that reached
 * it. Keeping a map of past positions in memory instead means the map can be
 * incomplete — which it was: the trainer only recorded a state once per
 * submitted move, so half the plies were missing, and a resumed session had
 * exactly one.
 */
export function replayLine(sans: string[], from = INITIAL_FEN): { fen: string; uci: string | null; san: string | null }[] {
	const out: { fen: string; uci: string | null; san: string | null }[] = [
		{ fen: from, uci: null, san: null },
	];
	let fen = from;
	for (const san of sans) {
		try {
			const r = applySan(fen, san);
			fen = r.fen;
			out.push({ fen, uci: r.uci, san });
		} catch {
			break;
		}
	}
	return out;
}

export function sideToMove(fen: string): 'w' | 'b' {
	return fen.split(' ')[1] === 'w' ? 'w' : 'b';
}

export function uciToMove(uci: string): Move | undefined {
	return parseUci(uci);
}

export { makeUci, makeSan, parseSquare, makeSquare };
