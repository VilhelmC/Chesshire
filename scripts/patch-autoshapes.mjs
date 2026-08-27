// Shapes get their own effect, and their own chessground call.
//
// The bug: switching the graph overlay's layer updated React state — the
// select's controlled value changed, the focus hint appeared and disappeared —
// and the board kept whatever it had drawn first. Even turning the overlay OFF
// left nine shapes on screen. The domain was fine throughout: calling
// `shapesFor` directly in the page returned 99 / 23 / 9 for the three layers.
//
// The cause is that autoShapes were being passed inside the big `cg.set({...})`
// alongside fen, orientation and movable. `set` merges configuration and
// redraws the BOARD; it does not reliably re-apply the drawable layer, so the
// SVG kept its first contents. Chessground has `setAutoShapes` for precisely
// this, and it redraws the shape layer.
//
// So shapes now have their own effect keyed on their own signature. That is
// also the right shape independent of the bug: shapes change far more often
// than orientation or size, and redrawing the whole board to move an arrow was
// always doing too much.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/components/Board.tsx';
let s = readFileSync(p, 'utf8');
if (s.includes('setAutoShapes')) { console.log('already patched'); process.exit(0); }
const was = s.length;

// 1. One place that turns props into chessground shapes, used by both the
//    initial config and the update effect — so they cannot drift.
const keyLine = "	const arrowsKey = arrows.map((a) => `${a.orig}${a.dest}${a.brush}${a.label ?? ''}`).join(',');";
if (!s.includes(keyLine)) { console.error('arrowsKey line missing'); process.exit(1); }
s = s.replace(
	keyLine,
	`${keyLine}
	// Built once, from the props, for both the initial config and the update
	// effect below. Two copies of this mapping is how a shape type gets supported
	// in one path and silently dropped in the other.
	const autoShapes = arrows.map((a) => ({
		orig: a.orig as Key,
		// A shape with no destination is a circle on its origin. The graph overlay
		// needs it: "this square's occupancy changes an edge" is a fact about the
		// square, and an arrow would invent a direction the fact does not have.
		...(a.dest ? { dest: a.dest as Key } : {}),
		brush: a.brush,
		// Chessground draws this at the arrow head. Putting the number on the board
		// means the arrow's weight and its value are read in one place.
		...(a.label ? { label: { text: a.label } } : {}),
	}));`,
);

// 2. Both config sites use it.
const inline = `				autoShapes: arrows.map((a) => ({
					orig: a.orig as Key,
					// A shape with no destination is a circle on its origin. The graph
					// overlay needs it: "this square's occupancy changes an edge" is a
					// fact about the square, and an arrow would invent a direction.
					...(a.dest ? { dest: a.dest as Key } : {}),
					brush: a.brush,
					// Chessground draws this at the arrow head. Putting the evaluation
					// on the board means the arrow's weight and its actual value are
					// read in one place, rather than eye-tracking to a side list.
					...(a.label ? { label: { text: a.label } } : {}),
				})),`;
if (!s.includes(inline)) { console.error('inline autoShapes block missing'); process.exit(1); }
s = s.replace(inline, '				autoShapes,');

// 3. The effect that actually keeps them current.
const deps = "	}, [fen, orientation, interactive, editable, movableColor, arrowsKey, version, size]);";
if (!s.includes(deps)) { console.error('effect deps missing'); process.exit(1); }
s = s.replace(
	deps,
	`	}, [fen, orientation, interactive, editable, movableColor, arrowsKey, version, size]);

	// Shapes, on their own, through the call chessground provides for them.
	//
	// They were riding along inside the \`set()\` above, which merges config and
	// redraws the board but leaves the drawable layer holding its first contents.
	// The symptom was an overlay frozen on whatever it drew first — including
	// refusing to clear when the layer was switched off.
	useEffect(() => {
		api.current?.setAutoShapes(autoShapes);
		// \`arrowsKey\` is the dependency rather than \`autoShapes\`, which is a fresh
		// array every render and would make this fire on every keystroke elsewhere.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [arrowsKey, version]);`,
);

writeFileSync(p, s);
console.log(`Board.tsx: autoShapes get their own effect (+${s.length - was} chars)`);
