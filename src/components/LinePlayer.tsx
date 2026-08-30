// Walk through a line the app has just claimed something about.
//
// The claim and the evidence belong in the same place. When the app says "you
// are a piece up once the exchange finishes", the exchange is the evidence, and
// leaving it as five tokens of notation means the reader has to reconstruct the
// position to check the claim — which is the work they are here to learn.
//
// This drives the board rather than drawing its own: the same squares, the same
// pieces, the same orientation. A second miniature board would be a second thing
// to learn to read.
//
// ---------------------------------------------------------------------------
// THE LAYOUT MOVED TO `LineStepper`, which the explainer now shares. This file
// is what remains: the name the rest of the app calls it by, and the `Line`-is-
// evidence framing above. Keeping it as a wrapper rather than renaming every
// call site is deliberate — `LinePlayer` reads as "the line under the board" at
// its five call sites, and `LineStepper` reads as "the widget".
// ---------------------------------------------------------------------------

import { LineStepper, type BoardOverride } from './LineStepper';
import type { Line } from '../domain/line';

export type { BoardOverride };

export function LinePlayer({
	line,
	label,
	onBoard,
	onClose,
}: {
	line: Line;
	/** What the line is evidence FOR. Shown above it. */
	label: string;
	/** Hand the board what to display, or null to give it back. */
	onBoard: (o: BoardOverride) => void;
	onClose: () => void;
}) {
	return <LineStepper line={line} label={label} onBoard={onBoard} onClose={onClose} region="line-player" />;
}
