// The app's mark, drawn inline so it follows the theme.
//
// An <img> cannot do this. A PNG has its colours baked in, and an SVG loaded
// through <img> gets its own rendering context — it can see the SYSTEM colour
// scheme through a media query, but not the app's own override, so choosing
// "light" while the phone is dark would leave the logo the only dark thing on
// the page.
//
// Inline, the paths inherit the same custom properties as everything else. The
// tile takes the page colour and the cat takes the ink, which is what makes the
// face read as emerging from the background rather than sitting on top of it —
// and it inverts with the rest of the app for free.

import { MARK_INNER, MARK_BOX } from './markPaths';
import { color } from './theme';

export function Mark({ size = 40, rounded = true }: { size?: number; rounded?: boolean }) {
	// The drawing is placed by its measured extent, not by its own coordinate
	// box, so the padding means the same thing here as it does on the icons.
	const pad = 0.1;
	const inset = size * pad;
	const avail = size - inset * 2;
	const scale = Math.min(avail / MARK_BOX.width, avail / MARK_BOX.height);
	const dx = inset + (avail - MARK_BOX.width * scale) / 2 - MARK_BOX.x * scale;
	const dy = inset + (avail - MARK_BOX.height * scale) / 2 - MARK_BOX.y * scale;

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			aria-hidden="true"
			style={{ flexShrink: 0, display: 'block' }}
		>
			<rect
				width={size}
				height={size}
				rx={rounded ? size * 0.19 : 0}
				fill={color.page}
			/>
			<g
				transform={`translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})`}
				fill={color.ink}
				// The source paths carry fill="#000000" as a presentation attribute,
				// which loses to any inherited value set this way.
				dangerouslySetInnerHTML={{ __html: withoutFills(MARK_INNER) }}
			/>
		</svg>
	);
}

/**
 * Strip the baked-in fills so the group's colour applies.
 *
 * A presentation attribute loses to a CSS rule but beats an inherited value,
 * and inheritance is what an inline `fill` on the parent group gives you — so
 * the attributes have to go rather than be outranked.
 */
function withoutFills(svg: string): string {
	return svg.replace(/\s(fill|stroke)="[^"]*"/g, '');
}
