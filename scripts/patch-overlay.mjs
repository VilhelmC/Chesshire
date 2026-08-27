// Wire the graph overlay into the board.
//
// Two small changes to Board.tsx: shapes may omit `dest` (chessground draws a
// circle, which is what a sensitive square is — a property of the square, not a
// direction), and four brushes for the overlay's own colours.
import { readFileSync, writeFileSync } from 'node:fs';

{
	const p = 'src/components/Board.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('gWhite')) { console.log('Board.tsx already patched'); }
	else {
		const t = 'arrows?: { orig: string; dest: string; brush: string; label?: string }[];';
		if (!s.includes(t)) { console.error('Board arrows type not found'); process.exit(1); }
		s = s.replace(t, 'arrows?: { orig: string; dest?: string; brush: string; label?: string }[];');

		s = s.replace(
			`				autoShapes: arrows.map((a) => ({
					orig: a.orig as Key,
					dest: a.dest as Key,`,
			`				autoShapes: arrows.map((a) => ({
					orig: a.orig as Key,
					// A shape with no destination is a circle on its origin. The graph
					// overlay needs it: "this square's occupancy changes an edge" is a
					// fact about the square, and an arrow would invent a direction.
					...(a.dest ? { dest: a.dest as Key } : {}),`,
		);

		s = s.replace(
			`				brushes: {
					...QUALITY_BRUSHES,
				},`,
			`				brushes: {
					...QUALITY_BRUSHES,
					...GRAPH_BRUSHES,
				},`,
		);
		s = s.replace(
			'export function Board({',
			`/**
 * The graph overlay's palette (DEFICIENCY.md §7, PLAN.md M1f).
 *
 * White and Black get different hues rather than two shades of one, because the
 * question asked of this picture is almost always "whose?" — and a board covered
 * in one colour at two opacities answers it slowly. Latent edges are the same
 * hue at low opacity and half the width: present, and visibly not acting.
 */
const GRAPH_BRUSHES = {
	gWhite: { key: 'gWhite', color: '#1f6feb', opacity: 0.55, lineWidth: 6 },
	gBlack: { key: 'gBlack', color: '#d2691e', opacity: 0.55, lineWidth: 6 },
	gWhiteX: { key: 'gWhiteX', color: '#1f6feb', opacity: 0.28, lineWidth: 3 },
	gBlackX: { key: 'gBlackX', color: '#d2691e', opacity: 0.28, lineWidth: 3 },
	gSense: { key: 'gSense', color: '#8957e5', opacity: 0.5, lineWidth: 4 },
};

export function Board({`,
		);
		writeFileSync(p, s);
		console.log('Board.tsx: optional dest + graph brushes');
	}
}

{
	const p = 'src/views/Lab.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('graphLayer')) { console.log('Lab.tsx already patched'); process.exit(0); }
	const was = s.length;

	s = s.replace(
		"import { LedgerPanel } from '../components/LedgerPanel';",
		`import { LedgerPanel } from '../components/LedgerPanel';
import { build as buildGraph } from '../domain/graph';
import { shapesFor, describe as readGraph, LAYERS, type Layer } from '../domain/graphShapes';`,
	);

	// state
	s = s.replace(
		"	const [showOld, setShowOld] = useState(false);",
		`	const [showOld, setShowOld] = useState(false);
	/** Which layer of the attack graph is drawn on the board (PLAN.md M1f). */
	const [graphLayer, setGraphLayer] = useState<Layer>('off');
	/** Clicking a square focuses the overlay on that piece; a full board is a hairball. */
	const [focus, setFocus] = useState<number | null>(null);`,
	);

	// derive shapes next to the existing arrow derivation
	const anchor = '	const engineRows = showEngine && engine && engine.key === key ? engine.value : null;';
	if (!s.includes(anchor)) { console.error('engineRows anchor missing'); process.exit(1); }
	s = s.replace(
		anchor,
		`	// The overlay is built from the position on screen, not from the puzzle —
	// free play and stepping both change it, and the picture must follow.
	const graph = useMemo(
		() => (graphLayer === 'off' || !step ? null : buildGraph(step.pos.board)),
		[graphLayer, step],
	);
	const graphShapes = useMemo(
		() => (graph ? shapesFor(graph, graphLayer, focus) : []),
		[graph, graphLayer, focus],
	);
	const graphNote = graph ? readGraph(graph, focus) : null;

${anchor}`,
	);

	writeFileSync(p, s);
	console.log(`Lab.tsx: overlay state and shapes (+${s.length - was} chars)`);
}

// --- render: the layer selector, the shapes, and click-to-focus -------------
{
	const p = 'src/views/Lab.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('graph layer')) { console.log('Lab render already patched'); process.exit(0); }
	const was = s.length;

	// The overlay wins the board when it is on: it is what you turned it on to see.
	const arrowsAnchor = `							arrows={
								playing
									? []`;
	if (!s.includes(arrowsAnchor)) { console.error('arrows anchor missing'); process.exit(1); }
	s = s.replace(
		arrowsAnchor,
		`							onSelectSquare={(sqName) =>
								setFocus((f) => {
									const n = parseSquare(sqName);
									return n === undefined || f === n ? null : n;
								})
							}
							arrows={
								graphLayer !== 'off'
									? graphShapes
									: playing
									? []`,
	);

	// The selector, beside the existing checkboxes.
	const boxAnchor = `					<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
						<input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />{' '}
						old depth search
					</label>`;
	if (!s.includes(boxAnchor)) { console.error('checkbox anchor missing'); process.exit(1); }
	s = s.replace(
		boxAnchor,
		`${boxAnchor}
					<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
						graph layer{' '}
						<select
							value={graphLayer}
							onChange={(e) => {
								setGraphLayer(e.target.value as Layer);
								setFocus(null);
							}}
						>
							{LAYERS.map((l) => (
								<option key={l.key} value={l.key}>
									{l.label}
								</option>
							))}
						</select>
					</label>`,
	);

	// The reading, under the board where the existing note lives.
	const noteAnchor = `						<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight }}>`;
	if (!s.includes(noteAnchor)) { console.error('note anchor missing'); process.exit(1); }
	s = s.replace(
		noteAnchor,
		`						{graphLayer !== 'off' && (
							<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight }}>
								{graphNote
									? \`\${makeSquare(focus as number)}: \${graphNote}\`
									: 'click a piece to show only its edges'}
							</div>
						)}
${noteAnchor}`,
	);

	// parseSquare is imported in Lab already? add if not.
	if (!/import \{[^}]*parseSquare/.test(s)) {
		s = s.replace("import { makeSquare, fenOf } from '../domain/chess';",
			"import { makeSquare, fenOf, parseSquare } from '../domain/chess';");
	}

	writeFileSync(p, s);
	console.log(`Lab.tsx: layer selector, overlay arrows, click-to-focus (+${s.length - was} chars)`);
}
