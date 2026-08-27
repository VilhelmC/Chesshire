// `describe` now asks the board whether an edge is live, so it needs one.
// AMEND-7-ONE-EDGE.md: liveness stopped being a field.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/views/Lab.tsx';
let s = readFileSync(p, 'utf8');
const t = 'const graphNote = graph ? readGraph(graph, focus) : null;';
if (!s.includes(t)) { console.log(s.includes('readGraph(graph, focus, ') ? 'already patched' : 'ANCHOR MISSING'); process.exit(0); }
s = s.replace(t, 'const graphNote = graph && step ? readGraph(graph, focus, step.pos.board) : null;');
writeFileSync(p, s);
console.log('Lab.tsx: readGraph takes the board');
