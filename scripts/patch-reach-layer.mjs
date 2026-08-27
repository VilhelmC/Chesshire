// Distance tint + gating squares on the board. PLAN.md M2 overlay row.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/components/Board.tsx';
let s = readFileSync(p, 'utf8');
if (s.includes('gD1')) { console.log('already patched'); process.exit(0); }
const t = "	gPinFaint: { key: 'gPinFaint', color: '#a371f7', opacity: 0.3, lineWidth: 3 },";
if (!s.includes(t)) { console.error('brush anchor missing'); process.exit(1); }
s = s.replace(
	t,
	`${t}
	// Distance, cool to warm: one ply away is close, four is nearly out of reach.
	// The number is drawn on the square too — a colour ramp alone is read as
	// "roughly", and a deadline is not a roughly.
	gD1: { key: 'gD1', color: '#3fb950', opacity: 0.7, lineWidth: 4 },
	gD2: { key: 'gD2', color: '#9e6a03', opacity: 0.6, lineWidth: 4 },
	gD3: { key: 'gD3', color: '#bd561d', opacity: 0.5, lineWidth: 4 },
	gD4: { key: 'gD4', color: '#8b949e', opacity: 0.4, lineWidth: 4 },
	// A square on every minimal route: block it and the journey lengthens.
	gGate: { key: 'gGate', color: '#f0883e', opacity: 0.9, lineWidth: 7 },`,
);
writeFileSync(p, s);
console.log('Board.tsx: distance and gate brushes');
