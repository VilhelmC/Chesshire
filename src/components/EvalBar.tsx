// Running evaluation, always visible.
//
// ---------------------------------------------------------------------------
// Vertical bar beside the board. It fills towards YOU as you do better — the
// bottom of the bar is the bottom of the board, which is your side.
//
// The usual convention is white-from-the-bottom always, and it was what this
// did. Sitting next to a board oriented for Black it reads backwards: your
// pieces are at the bottom, your advantage grows at the top, and the learner
// has to remember which of the two adjacent spatial encodings is absolute and
// which is relative. That is a derivation the app can simply remove (§1.1).
// The fill is still tinted by actual piece colour, so nothing about "white is
// light" is lost.
//
// The number is shown as well as the fill — a bar alone is a magnitude with no
// scale, and at this level the whole point is to learn what "+1.5" feels like
// on a board.
// ---------------------------------------------------------------------------

const LIGHT = '#f2f1ee';
const DARK = '#3a3a38';

export function EvalBar({
	cp,
	ourColour,
	height = 420,
	width = 30,
}: {
	/** Centipawns from OUR point of view. Null when unknown — never faked to 0. */
	cp: number | null;
	ourColour: 'w' | 'b';
	height?: number;
	/** Narrower on a phone, where 30px of a 360px screen is a real cost. */
	width?: number;
}) {
	// Squash centipawns into 0..1. A logistic, so the same 80cp is worth
	// progressively less bar the further from equality it is: the difference
	// between 0.0 and +0.8 matters enormously, the difference between +12 and +15
	// not at all. It flattens gradually rather than cutting off — around ±600 it
	// is still moving perceptibly, which is correct, since that is a winning but
	// not yet won position.
	const share = cp === null ? 0.5 : 1 / (1 + Math.exp(-cp / 320));
	const ourHeight = Math.round(height * share);

	const ours = ourColour === 'w' ? LIGHT : DARK;
	const theirs = ourColour === 'w' ? DARK : LIGHT;

	const label =
		cp === null
			? '—'
			: Math.abs(cp) > 9000
				? cp > 0
					? '#'
					: '-#'
				: `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;

	return (
		<div
			title={
				cp === null
					? 'Evaluation not available'
					: `Evaluation from your point of view: ${label}. The bar fills towards you.`
			}
			style={{
				width,
				height,
				position: 'relative',
				background: theirs,
				borderRadius: 4,
				overflow: 'hidden',
				flexShrink: 0,
				// Without this a light bar on a light page has no edge.
				boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
			}}
		>
			<div
				style={{
					position: 'absolute',
					bottom: 0,
					left: 0,
					right: 0,
					height: ourHeight,
					background: ours,
					transition: 'height 240ms ease',
				}}
			/>
			{/* midline, so "equal" is readable at a glance */}
			<div
				style={{
					position: 'absolute',
					top: height / 2,
					left: 0,
					right: 0,
					height: 1,
					background: '#8a8a86',
					opacity: 0.7,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					// The number sits in whichever end has room, and takes the contrast
					// of the band it lands in.
					top: share > 0.5 ? 4 : undefined,
					bottom: share > 0.5 ? undefined : 4,
					textAlign: 'center',
					fontSize: width < 24 ? 9 : 10,
					fontWeight: 700,
					letterSpacing: -0.2,
					color: (share > 0.5 ? theirs : ours) === LIGHT ? '#2b2b29' : '#f2f1ee',
				}}
			>
				{label}
			</div>
		</div>
	);
}
