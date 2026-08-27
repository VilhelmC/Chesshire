// How big is the tree the theory says we traverse?
//
// §6.2: "Depth is the number of couplings; branching is the arity of each. Both
// are known before the computation begins." That is the load-bearing claim — if
// the leaf set is small the traversal is cheap and exact, and if it is not the
// whole approach is a search wearing different words. So it gets counted.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ts-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { chains, couplings } from './src/domain/couple';
export { gamma, due } from './src/domain/cover2';
export { see } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
const pct = (a, n) => { a.sort((x, y) => x - y); return { med: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }; };
const chainsN = [], coupN = [], leafN = [], stepN = [];
let plies = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const cs = M.chains(pos.board);
			const cp = M.couplings(pos.board);
			chainsN.push(cs.length);
			coupN.push(cp.length);
			// The leaf set: each coupling is a binary commitment (§6.2 — the
			// defender allocates, sequentially). Independent chains simply add and
			// contribute no branching at all (§6.1).
			leafN.push(Math.pow(2, Math.min(cp.length, 20)));
			// And how deep any single exchange runs, since a leaf is a chain under
			// a partition and a parity.
			for (const c of cs) stepN.push(M.see(pos.board, c.square, c.taker).depth);
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const f = (label, a) => { const s = pct(a); console.log(`  ${label.padEnd(28)} median ${String(s.med).padStart(5)}   p95 ${String(s.p95).padStart(6)}   max ${String(s.max).padStart(7)}`); };
console.log(`\n${P.length} puzzles · ${plies} solver plies\n`);
f('exchange squares (chains)', chainsN);
f('couplings — the branch points', coupN);
f('leaves = 2^couplings', leafN);
f('captures in one chain', stepN);
console.log(`\n  positions with NO coupling at all: ${coupN.filter((x) => !x).length} (${(100*coupN.filter((x)=>!x).length/plies).toFixed(1)}%) — these are a pure SUM, no tree`);
