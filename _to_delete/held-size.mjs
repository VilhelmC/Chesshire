// How many squares are safe ONLY because some piece stays where it is?
//
// The rule that replaced `commit.ts`'s allocation: do not allocate at all. File a
// row per (square, holder) pair whose safety depends on that piece staying put,
// give the piece a cost-0 discharge of it, and let the traversal's distinct-piece
// matching decide. A piece holding two such squares can hold only one — §3's
// cardinality, where the theory already says double duty lives.
//
// Two things this has to establish. That the row count stays inside the per-side
// bound the enumeration is exponential in, and that the case the rule EXISTS for
// — one piece, two squares — actually occurs.
//
// Asks the module rather than reimplementing it. An earlier version of this probe
// carried its own copy of the rule, which meant it could agree with a module that
// had since changed.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'hs-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { obligations, held } from './src/domain/complex';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let n = 0, withHeld = 0, maxHeld = 0, worstSide = 0, over = 0, doubleDuty = 0, kingHolders = 0, holders = 0;
const hist = new Map();
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const b = pos.board;
		const h = M.held(b);
		const rows = M.obligations(b);
		// The enumeration is PER SIDE — 2^k over each side's own rows, never over
		// the union — so that is what the bound is about.
		const perSide = { white: 0, black: 0 };
		for (const r of rows) perSide[M.other(r.claimant)]++;
		const worst = Math.max(perSide.white, perSide.black);
		worstSide = Math.max(worstSide, worst);
		if (worst > 16) over++;

		const squares = new Set(h.map((r) => r.square));
		if (squares.size) withHeld++;
		maxHeld = Math.max(maxHeld, squares.size);
		hist.set(squares.size, (hist.get(squares.size) ?? 0) + 1);

		const byPiece = new Map();
		for (const r of h) {
			holders++;
			if (b.get(r.holder)?.role === 'king') kingHolders++;
			byPiece.set(r.holder, (byPiece.get(r.holder) ?? 0) + 1);
		}
		for (const [, k] of byPiece) if (k > 1) { doubleDuty++; break; }
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions`);
console.log(`  with a held square         : ${withHeld} (${(100*withHeld/n).toFixed(1)}%)`);
console.log(`  most held squares          : ${maxHeld}`);
console.log(`  most rows on ONE side      : ${worstSide}   over MAX_ROWS=16: ${over}`);
console.log(`  holder relations           : ${holders}   of which the holder is a king: ${kingHolders}`);
console.log(`  positions where one piece holds two : ${doubleDuty} (${(100*doubleDuty/n).toFixed(1)}%)`);
console.log(`\n  held squares · positions`);
for (const k of [...hist.keys()].sort((a,b)=>a-b)) console.log(`    ${String(k).padStart(3)} · ${hist.get(k)}`);
