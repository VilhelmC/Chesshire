// Two implementations of one definition, compared on the corpus.
//
// scripts/couple-unified.mjs computed the coupling conditions inline while the
// amendment was being argued; src/domain/couple.ts computes them as a module.
// They were written from the same statement and are otherwise independent, so
// disagreement means one of them is wrong and the definition is not yet real.
//
// This is the check that caught the drift harness overstating by 3x and the
// ledger's incremental/rebuild gap. Rule 5.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ca-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { couplings, chains } from './src/domain/couple';
export { build, on } from './src/domain/graph';
export { see, seeValue, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

// ---- The inline implementation, transcribed from couple-unified.mjs.
const inlineChains = (board, g) => {
	const out = [];
	for (const s of board.occupied) {
		const w = M.on(g, s, 'white'), b = M.on(g, s, 'black');
		if (!w.length || !b.length) continue;
		const owner = board.get(s).color, taker = M.other(owner);
		out.push({ square: s, owner, taker, defenders: owner === 'white' ? w : b, see: M.seeValue(board, s, taker) });
	}
	return out;
};
function inlineResolved(board, c) {
	const b = board.clone();
	const ex = M.see(board, c.square, c.taker);
	if (!ex.steps.length) return b;
	const last = ex.steps[ex.steps.length - 1];
	for (const st of ex.steps) b.take(st.from);
	b.take(c.square);
	b.set(c.square, { color: last.side, role: last.promotes ? 'queen' : last.role });
	return b;
}
function inlineCouplings(board) {
	const cs = inlineChains(board, M.build(board));
	const res = [], com = [];
	for (const a of cs) {
		const after = inlineResolved(board, a);
		for (const b of cs) {
			if (a.square === b.square) continue;
			if (!after.occupied.has(b.square)) continue;
			const now = M.seeValue(after, b.square, b.taker);
			if (now !== b.see) res.push(`R:${sq(a.square)}>${sq(b.square)}:${b.see}>${now}`);
		}
	}
	const duty = new Map();
	for (const c of cs) for (const p of c.defenders) { if (!duty.has(p)) duty.set(p, []); duty.get(p).push(c); }
	for (const [p, held] of duty) {
		if (held.length < 2) continue;
		const gone = board.clone(); gone.take(p);
		const falls = held.filter((c) => c.see <= 0 && M.seeValue(gone, c.square, c.taker) > 0);
		if (falls.length >= 2) com.push(`C:${sq(p)}:${falls.map((c) => sq(c.square)).sort().join('+')}`);
	}
	return [...res, ...com].sort();
}
const fromModule = (board) => M.couplings(board).map((c) =>
	c.kind === 'commitment' ? `C:${sq(c.piece)}:${c.holds.map(sq).sort().join('+')}`
		: `R:${sq(c.from)}>${sq(c.to)}:${c.was}>${c.becomes}`).sort();

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let plies = 0, agree = 0, withAny = 0, res = 0, com = 0, maxN = 0;
const diffs = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		plies++;
		const a = inlineCouplings(pos.board), b = fromModule(pos.board);
		if (JSON.stringify(a) === JSON.stringify(b)) agree++;
		else if (diffs.length < 5) diffs.push({ id: p.id, i, inline: a, module: b });
		if (b.length) withAny++;
		res += b.filter((x) => x[0] === 'R').length;
		com += b.filter((x) => x[0] === 'C').length;
		maxN = Math.max(maxN, b.length);
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${plies} positions · ${agree} agree (${(100*agree/plies).toFixed(1)}%)\n`);
console.log(`  positions with a coupling  ${withAny} (${(100*withAny/plies).toFixed(1)}%)`);
console.log(`  resolution couplings       ${res}`);
console.log(`  commitment couplings       ${com}`);
console.log(`  most in one position       ${maxN}`);
for (const x of diffs) console.log('\n  DIFF', x.id, 'ply', x.i, '\n    inline:', JSON.stringify(x.inline), '\n    module:', JSON.stringify(x.module));
