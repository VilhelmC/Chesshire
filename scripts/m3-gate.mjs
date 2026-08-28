// M3 GATE — the ladder against the corpus, in `choose`'s own buckets.
//
//   found  the answer is the ladder's ONLY answer
//   tied   it is among several, all genuinely achieving the same rung
//   wrong  the ladder answers, and the puzzle's move is not among them
//   blind  the ladder answers nothing at all
//
// Baseline to beat: 1523 found / 729 wrong over 2656 solver plies.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 40);
const D = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'm3g-'));
const e = join(process.cwd(), '.m3g-entry.ts');
writeFileSync(e, `export { ladderChoose } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = M.makeSquare;
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const PR = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
const mk = (u) => { const m = { from: idx(u), to: idx(u.slice(2)) }; if (u[4]) m.promotion = PR[u[4]]; return m; };
const play = (p, m) => { const n = p.clone(); n.play(m); return n; };
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const b = { found: 0, tied: 0, wrong: 0, blind: 0 };
let plies = 0, nodes = 0, ms = 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const want = p.moves[i].slice(0, 4);
			const t0 = Date.now();
			let r; try { r = M.ladderChoose(pos, D); } catch { break; }
			ms += Date.now() - t0; nodes += r.nodes; plies++;
			const set = r.moves.map((m) => sq(m.from) + sq(m.to));
			if (!set.length) b.blind++;
			else if (set.length === 1 && set[0] === want) b.found++;
			else if (set.includes(want)) b.tied++;
			else b.wrong++;
		}
		try { pos = play(pos, mk(p.moves[i])); } catch { break; }
	}
}
const pc = (n) => `${((100 * n) / plies).toFixed(1)}%`;
console.log(`\n  ${plies} solver plies over ${P.length} puzzles, ladder depth ${D}`);
console.log(`    found  ${String(b.found).padStart(5)}  ${pc(b.found)}`);
console.log(`    tied   ${String(b.tied).padStart(5)}  ${pc(b.tied)}`);
console.log(`    wrong  ${String(b.wrong).padStart(5)}  ${pc(b.wrong)}`);
console.log(`    blind  ${String(b.blind).padStart(5)}  ${pc(b.blind)}`);
console.log(`    cost   ${(nodes / plies).toFixed(0)} nodes/ply, ${(ms / plies).toFixed(0)}ms/ply, ${(ms / 1000).toFixed(1)}s total`);
