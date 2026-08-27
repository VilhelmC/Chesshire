// Is mate-in-1 already visible?
//
// §1's table says mate is the king's square, weight ∞, deadline 1 — and the
// ledger already produces that, because V[king] = Infinity. So mate-in-1 should
// be Γ reporting `emptiness` on an infinite row after the move, with no new
// machinery at all. Asked before anything is designed.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'mp-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, classify2, cover, due } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { concedes } from './src/domain/concede2';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

// The LAST solver move of a mateIn1/2/3 puzzle is the mating move.
let n = 0, sawInfinite = 0, sawEmpty = 0, scoredInf = 0, realMate = 0;
const misses = [];
const why = {};
for (const p of P.filter((x) => x.themes.some((t) => t.startsWith('mateIn')))) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length - 1; i++) pos = play(pos, p.moves[i]);
	const last = p.moves[p.moves.length - 1];
	let after; try { after = play(pos, last); } catch { continue; }
	n++;
	if (after.isEnd() && after.isCheckmate()) realMate++;
	const them = after.turn;
	const E = M.ledger(after, them).filter((x) => M.isLive(x, after.board));
	const inf = E.filter((x) => x.weight === Infinity);
	if (inf.length) sawInfinite++;
	const g = M.gamma(after, { owed: them });
	const mode = M.classify2(g, after.board, them);
	if (inf.length && mode === 'emptiness') sawEmpty++;
	const c = M.concedes(after, them);
	if (c.loss === Infinity) scoredInf++;
	else {
		// Grouped by which discharge Γ still believes in, because 23 positions
		// inspected one at a time is three hours and one histogram is a minute.
		const j = E.findIndex((x) => x.weight === Infinity);
		const kinds = [...new Set(g.edges.filter((x) => x.obligation === j).map((x) => x.kind))].sort().join('+') || 'none';
		why[kinds] = (why[kinds] ?? 0) + 1;
		if (misses.length < 8) misses.push(`${p.id} ${last} mode=${mode} believes=${kinds} loss=${c.loss}`);
	}
}
console.log(`\n${n} mating moves from mateIn* puzzles\n`);
const pc = (x) => `${x} (${(100*x/n).toFixed(1)}%)`;
console.log(`  actually checkmate on the board     ${pc(realMate)}`);
console.log(`  ledger records an INFINITE row      ${pc(sawInfinite)}`);
console.log(`  ...and Γ calls it emptiness         ${pc(sawEmpty)}`);
console.log(`  concedes() returns Infinity         ${pc(scoredInf)}`);
console.log(`\n  the discharge Γ still believes in:`, JSON.stringify(why));
console.log(`\n  not scored as mate, first few:`);
for (const m of misses) console.log('   ', m);
