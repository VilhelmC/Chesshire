// The cost-k row for every piece — how many, how fast, and does it price?
//
// FINDING-INVASION measured this row inside `rank.ts` and refused to build it.
// That was a fact about a scorer. Here it is a row in the traversal, where the
// defender's tempi are counted against its deadline — the exact thing the
// finding said was missing. Measured again before it is wired in.
//
// Three questions, in order:
//   1. how many rows, and does any position exceed the per-side bound?
//   2. how long does the pass take?
//   3. does the traversal's value move, and in both directions?
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const H = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'as-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, obligations, arrivals } from './src/domain/complex';
export { gamma } from './src/domain/gamma';
export { traverse, say } from './src/domain/traverse';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let n = 0, withRows = 0, maxRows = 0, worstSide = 0, over = 0, moved = 0, toW = 0, toB = 0, refused = 0;
let ms = 0;
const byK = new Map();
const examples = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const t0 = process.hrtime.bigint();
		const extra = M.arrivals(pos.board, { arrivalHorizon: H });
		ms += Number(process.hrtime.bigint() - t0) / 1e6;

		if (extra.length) withRows++;
		maxRows = Math.max(maxRows, extra.length);
		for (const r of extra) byK.set(r.deadline, (byK.get(r.deadline) ?? 0) + 1);

		const base = M.complex(pos);
		const withArr = { ...base, obligations: [...base.obligations, ...extra] };
		const perSide = { white: 0, black: 0 };
		for (const r of withArr.obligations) perSide[M.other(r.claimant)]++;
		const worst = Math.max(perSide.white, perSide.black);
		worstSide = Math.max(worstSide, worst);
		if (worst > 16) over++;

		const a = M.traverse(withArr), b = M.traverse(base);
		if (a.refused) refused++;
		else if (a.value !== b.value) {
			moved++;
			if (a.value > b.value) toW++; else toB++;
			if (examples.length < 5) examples.push(`${p.id} ply ${i}  ${b.value} -> ${a.value}\n      ${M.makeFen(pos.toSetup())}\n      ${extra.map((r) => `${sq(r.square)}<${sq(r.from)} ${r.weight}/${r.deadline}${r.claimant[0]}`).join('  ')}`);
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions, horizon ${H}`);
console.log(`  with an arrival row     : ${withRows} (${(100*withRows/n).toFixed(1)}%)   most in one position: ${maxRows}`);
console.log(`  most rows on ONE side   : ${worstSide}   over MAX_ROWS=16: ${over}`);
console.log(`  traversal value moved   : ${moved} (${(100*moved/n).toFixed(1)}%)   toward White ${toW}, toward Black ${toB}   refused ${refused}`);
console.log(`  arrivals() cost         : ${(ms/n).toFixed(2)} ms per position`);
console.log(`\n  deadline · rows`);
for (const k of [...byK.keys()].sort((a,b)=>a-b)) console.log(`    ${String(k).padStart(3)} · ${byK.get(k)}`);
console.log('');
for (const x of examples) console.log(`  ${x}\n`);
