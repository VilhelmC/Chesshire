// The motif layer: exchanges, undefended pieces, pins — and dashed x-rays.
// PLAN-OVERLAY.md.
import { readFileSync, writeFileSync } from 'node:fs';

{
	const p = 'src/components/Board.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('gExchange')) console.log('Board brushes already patched');
	else {
		s = s.replace(
			"	gSense: { key: 'gSense', color: '#8957e5', opacity: 0.5, lineWidth: 4 },",
			`	gSense: { key: 'gSense', color: '#8957e5', opacity: 0.5, lineWidth: 4 },
	// Square facts (PLAN-OVERLAY.md). Amber for a contested square, red for one
	// only the enemy bears on, violet for the pin family — so hue alone says
	// which KIND of fact it is, before any reading.
	gExchange: { key: 'gExchange', color: '#d29922', opacity: 0.75, lineWidth: 5 },
	gLoose: { key: 'gLoose', color: '#da3633', opacity: 0.8, lineWidth: 5 },
	gPin: { key: 'gPin', color: '#a371f7', opacity: 0.85, lineWidth: 6 },
	gPinSoft: { key: 'gPinSoft', color: '#a371f7', opacity: 0.5, lineWidth: 4 },
	gPinFaint: { key: 'gPinFaint', color: '#a371f7', opacity: 0.3, lineWidth: 3 },`,
		);
		writeFileSync(p, s);
		console.log('Board.tsx: motif brushes');
	}
}

{
	// Dashed x-rays. Chessground renders an arrow as
	//   <line marker-end="url(#arrowhead-<brushKey>)">
	// so the dash attaches by BRUSH KEY rather than by colour — stable if the
	// palette changes, and no patch to chessground. Dash length is in board
	// units, where one square is 1.
	const p = 'src/index.css';
	let s = readFileSync(p, 'utf8');
	if (s.includes('arrowhead-gWhiteX')) console.log('index.css already patched');
	else {
		s += `

/* The graph overlay's latent edges are drawn dashed: present, and visibly not
   acting. See PLAN-OVERLAY.md. */
.cg-shapes line[marker-end="url(#arrowhead-gWhiteX)"],
.cg-shapes line[marker-end="url(#arrowhead-gBlackX)"] {
	stroke-dasharray: 0.1 0.09;
}
`;
		writeFileSync(p, s);
		console.log('index.css: dashed latent edges');
	}
}

{
	const p = 'src/views/Lab.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('graphLayer, focus, step')) console.log('Lab already passes the board');
	else {
		const t = '() => (graph ? shapesFor(graph, graphLayer, focus) : []),\n\t\t[graph, graphLayer, focus],';
		if (!s.includes(t)) { console.error('shapesFor call not found'); process.exit(1); }
		s = s.replace(
			t,
			'() => (graph && step ? shapesFor(graph, graphLayer, focus, step.pos.board) : []),\n\t\t[graph, graphLayer, focus, step],',
		);
		writeFileSync(p, s);
		console.log('Lab.tsx: board passed to shapesFor');
	}
}
