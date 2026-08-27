// Where does `choose` spend 247 ms a ply? Measured before anything is optimised.
//
// §7 says a move is three lookups and the code rebuilds the whole complex per
// option, so the replay is certainly part of it. But "certainly part of it" is
// not a number, and optimising the wrong half is the usual way to spend a day.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 20);
const ARR = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'pf-'));
const e = join(process.cwd(), '.pf-entry.ts');
writeFileSync(e, `export { complex, obligations, arrivals } from './src/domain/complex';
export { sites, clusters, priced } from './src/domain/cluster';
export { chains, couplings } from './src/domain/couple';
export { build } from './src/domain/graph';
export { gamma } from './src/domain/gamma';
export { traverse } from './src/domain/traverse';
export { options } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const t = {};
const time = (k, f) => { const a = process.hrtime.bigint(); const r = f(); t[k] = (t[k] ?? 0) + Number(process.hrtime.bigint() - a) / 1e6; return r; };

let n = 0, opts = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			n++;
			const b = pos.board;
			time('graph.build', () => M.build(b));
			time('couple.chains', () => M.chains(b));
			time('couple.couplings', () => M.couplings(b));
			time('cluster.sites', () => M.sites(b));
			time('cluster.clusters', () => M.clusters(b));
			time('cluster.priced (§6 minimax)', () => M.priced(b, pos.turn));
			time('complex.arrivals', () => M.arrivals(b, OPTS));
			time('complex.obligations', () => M.obligations(b, OPTS));
			const c = time('complex (whole)', () => M.complex(pos, OPTS));
			time('gamma', () => M.gamma(c));
			time('traverse', () => M.traverse(c));
			const os = time('choose.options', () => M.options(c, pos));
			opts += os.length;
			// The replay itself: clone + play, per option, nothing else.
			time('replay only (clone+play)', () => {
				for (const op of os) {
					const nx = pos.clone();
					try { nx.play({ from: op.from, to: op.to }); } catch { /* illegal promotion form */ }
				}
			});
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} plies, ${(opts / n).toFixed(1)} options a ply, arrival horizon ${ARR}\n`);
const rows = Object.entries(t).sort((a, b) => b[1] - a[1]);
for (const [k, ms] of rows) console.log(`  ${k.padEnd(28)} ${(ms / n).toFixed(2).padStart(8)} ms/ply   ${((ms / n) * (opts / n)).toFixed(0).padStart(6)} ms if run per option`);
console.log(`\n  "per option" is what `.trim() + ` choose() actually pays, since it rebuilds everything for each.\n`);
