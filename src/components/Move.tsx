// A move, rendered as `♞ Nf6`.
//
// The glyph sits in a fixed-width box so that a column of moves aligns on the
// notation regardless of which pieces moved — a ragged left edge is exactly the
// kind of small friction this change exists to remove.

import { glyphForSan, colourOfFen, type Colour } from '../domain/notation';

export function Move({
	san,
	colour,
	/** Alternative to `colour`: the position the move was played FROM. */
	fen,
	bold = false,
	size,
	title,
}: {
	san: string;
	colour?: Colour;
	fen?: string;
	bold?: boolean;
	size?: number;
	title?: string;
}) {
	const c: Colour = colour ?? (fen ? colourOfFen(fen) : 'w');
	return (
		<span
			title={title}
			style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}
		>
			<span
				aria-hidden
				style={{
					fontSize: size ? size + 3 : 16,
					width: size ? size + 4 : 17,
					textAlign: 'center',
					lineHeight: 1,
					flexShrink: 0,
				}}
			>
				{glyphForSan(san, c)}
			</span>
			<span
				style={{
					fontFamily: 'ui-monospace, monospace',
					fontWeight: bold ? 700 : undefined,
					...(size ? { fontSize: size } : {}),
				}}
			>
				{san}
			</span>
		</span>
	);
}

/**
 * A run of SAN moves as `1. ♙ e4 ♟ e5 2. ♘ Nf3 …`.
 *
 * Used wherever a line was previously joined with spaces into a bare string.
 */
export function MoveLine({
	sans,
	from = 0,
	size = 13,
}: {
	sans: string[];
	/** Ply the first move sits at, so colours stay right mid-line. */
	from?: number;
	size?: number;
}) {
	return (
		<span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
			{sans.map((san, i) => {
				const ply = from + i;
				return (
					<span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
						{ply % 2 === 0 && (
							<span style={{ fontSize: size - 1, opacity: 0.45 }}>{ply / 2 + 1}.</span>
						)}
						<Move san={san} colour={ply % 2 === 0 ? 'w' : 'b'} size={size} />
					</span>
				);
			})}
		</span>
	);
}
