// Is there anything written about this position, and what does it say.
//
// ---------------------------------------------------------------------------
// THE REGISTER DECIDES WHETHER THE DOOR IS DRAWN.
//
// Today's other bug was a button that did nothing: pressing "played here" on a
// move-26 position produced no rows, no chip and no message, and a button that
// answers silence reads as broken rather than as answered. Commentary would
// have the same failure on a far larger share of positions — nine plies in ten
// have no page — so the button is not drawn at all unless the register says
// there is something behind it.
//
// That is why the lookup is separate from the fetch, and why the lookup is the
// cheap one: a Map hit against a table already in memory, no request, no wait.
// Nothing is fetched until a reader asks.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { positionKey, applyUci } from '../domain/chess';
import { pageFor, fetchCommentary, type Commentary } from '../data/commentary';

export type CommentaryState = {
	/** There is a page for this position. The only thing the host needs to decide whether to offer it. */
	available: boolean;
	open: boolean;
	setOpen: (open: boolean) => void;
	/** Null until fetched, and null forever for a page that turned out to be a stub. */
	text: Commentary | null;
	busy: boolean;
	error: string | null;
	/** The move to point at inside the page, in the notation the page uses. */
	highlight: string | undefined;
};

/**
 * @param fen  the position ON THE BOARD, so the panel and the board never
 *             describe different positions.
 * @param uci  a move being asked about from that position, if there is one. The
 *             page for a position is written about the moves leaving it, so
 *             this is the move the prose might name — see `paragraphFor`.
 */
export function useCommentary(fen: string | null, uci?: string | null): CommentaryState {
	const [page, setPage] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [text, setText] = useState<Commentary | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// THE LOOKUP. Runs on every position; costs a Map hit once the register is
	// up, and one build the first time anything asks.
	useEffect(() => {
		let live = true;
		setPage(null);
		setText(null);
		setError(null);
		if (!fen) return;
		void (async () => {
			try {
				const hit = await pageFor(positionKey(fen));
				if (live) setPage(hit);
			} catch {
				// A register that will not build is a feature that does not appear.
				// It is not an error the reader has to be told about — they did not
				// ask for anything yet.
				if (live) setPage(null);
			}
		})();
		return () => {
			live = false;
		};
	}, [fen]);

	// THE FETCH. Only once opened.
	useEffect(() => {
		let live = true;
		if (!open || !page) return;
		setBusy(true);
		setError(null);
		void (async () => {
			try {
				const got = await fetchCommentary(page);
				if (live) setText(got);
			} catch (e) {
				if (live) setError((e as Error).message);
			} finally {
				if (live) setBusy(false);
			}
		})();
		return () => {
			live = false;
		};
	}, [open, page]);

	// A new position closes the last one. Leaving it open would put one
	// position's commentary under another position's board, which is the same
	// error as an overlay computed for a board that is not on screen.
	useEffect(() => setOpen(false), [fen]);

	// The move in the notation the prose uses. Silent when the move does not
	// belong to this position — which happens for a frame whenever the board
	// moves ahead of the question.
	const highlight = useMemo(() => {
		if (!fen || !uci) return undefined;
		try {
			return applyUci(fen, uci).san;
		} catch {
			return undefined;
		}
	}, [fen, uci]);

	return { available: page !== null, open, setOpen, text, busy, error, highlight };
}
