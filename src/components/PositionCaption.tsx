// The one line above every board: where you are, and why you are looking.
//
// ---------------------------------------------------------------------------
// The rule this completes, from `BoardPanel`'s header:
//
//   0. WHERE YOU ARE                              <- this
//   1. evaluation bar, board, captured material   <- BoardPanel
//   2. the control strip                          <- BoardPanel
//   3–6. what just happened, the analysis, the history, the options
//                                                 <- PositionStack
//
// Step 0 is new, and it is the same move steps 1–6 already made. Train wrote
// this line by hand above its board; Quiz and Play wrote nothing; Review said
// "ply 12 / 42". Making it a slot on the component every board goes through
// means a screen cannot forget it and cannot invent a different one.
//
// ---------------------------------------------------------------------------
// WHY THE VIEW PASSES NODES AND NOT A STRING.
//
// "you played ♞Nxe5" wants the app's piece glyph, which is a component — see
// `ui/Piece` for why a bare character cannot carry a side. So `also` takes
// nodes. What it does NOT take is a layout: the segments are laid out here, in
// one sequence with one separator, so the only freedom a caller has is WHAT to
// say. Where it goes and how it reads are not the caller's business, which is
// the whole point of moving this out of four views.
//
// The height is RESERVED even when empty. The line comes and goes — the
// starting position has nothing to say, a fetched opening name arrives a moment
// after the board does — and a caption that collapses drags the board up and
// down under the cursor while you are trying to move a piece.
// ---------------------------------------------------------------------------

import { whereYouAre, type Where } from '../domain/caption';
import { color } from '../ui/theme';

export type CaptionProps = Where & {
	/** Segments the view adds. Falsy entries are dropped, so `cond && x` is fine. */
	also?: React.ReactNode[];
};

/** Between segments. A middot, because a comma is already inside "Scotch, move 5". */
const SEP = ' · ';

export function PositionCaption({ path, opening, ply, also = [] }: CaptionProps) {
	const where = whereYouAre({ path, opening, ply });
	const parts: React.ReactNode[] = [];
	if (where) parts.push(where);
	for (const a of also) if (a) parts.push(a);

	return (
		<div
			data-region="position-caption"
			style={{
				margin: '0 0 6px',
				fontSize: 13,
				lineHeight: '18px',
				color: color.ink2,
				// See the header: reserved, not conditional.
				minHeight: 18,
				display: 'flex',
				alignItems: 'baseline',
				flexWrap: 'wrap',
				gap: 0,
			}}
		>
			{parts.map((p, i) => (
				<span key={i} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
					{i > 0 && <span style={{ opacity: 0.6, whiteSpace: 'pre' }}>{SEP}</span>}
					{p}
				</span>
			))}
		</div>
	);
}
