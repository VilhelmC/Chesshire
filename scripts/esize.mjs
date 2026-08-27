// How big does E get? §4's unrolling has depth |E|, so the recurrence is only
// tractable if |E| is small — and "small" is a measurement, not a hope.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'es-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, due } from './src/domain/cover2';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, 150);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
const histE = {}, histDue = {}, histMoves = {};
let n = 0, maxE = 0, maxM = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			n++;
			for (const owed of ['white', 'black']) {
				const g = M.gamma(pos, { owed });
				const moves = new Set(g.edges.filter((x) => x.cost === 1).map((x) => `${x.piece}:${x.to}`)).size;
				histE[g.E.length] = (histE[g.E.length] ?? 0) + 1;
				histDue[M.due(g).length] = (histDue[M.due(g).length] ?? 0) + 1;
				histMoves[Math.min(moves, 30)] = (histMoves[Math.min(moves, 30)] ?? 0) + 1;
				maxE = Math.max(maxE, g.E.length); maxM = Math.max(maxM, moves);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const show = (label, h) => console.log(`  ${label.padEnd(18)}` + Object.entries(h).sort((a,b)=>+a[0]-+b[0]).map(([k,v])=>`${k}:${v}`).join(' '));
console.log(`\n${n} solver plies, both sides\n`);
show('|E|', histE); show('|due|', histDue); show('distinct moves', histMoves);
console.log(`\n  max |E| = ${maxE} · max distinct cost-1 moves = ${maxM}`);
