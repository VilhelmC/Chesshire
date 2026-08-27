// One test instead of four?
//
// The census said §6.1's four kinds, taken as MECHANISMS, over-fire: contested
// squares fire on 92.7% of plies, which cannot be a branch point. §6.1 already
// states the right condition, but only for the x-ray:
//
//     "resolving chain A changes chain B's participant set"
//
// This asks whether that condition, applied to all four, lands somewhere a tree
// can actually branch on. It also measures the overload properly: a defender is
// overloaded when each chain is held WHILE IT STAYS and lost when it leaves —
// so filtering to chains that are already losing (the census's 1.7%) was the
// wrong filter, and would have hidden the motif this milestone exists for.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'cu-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { build, on } from './src/domain/graph';
export { see, seeValue, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);
const sq = (s) => M.makeSquare(s);

const chainsOf = (board, g) => {
	const out = [];
	for (const s of board.occupied) {
		const w = M.on(g, s, 'white'), b = M.on(g, s, 'black');
		if (!w.length || !b.length) continue;
		const owner = board.get(s).color;
		const taker = M.other(owner);
		out.push({ square: s, owner, taker, defenders: owner === 'white' ? w : b, see: M.seeValue(board, s, taker) });
	}
	return out;
};

/** The board once the exchange at `c` has played itself out. */
function resolved(board, c) {
	const b = board.clone();
	const ex = M.see(board, c.square, c.taker);
	// `steps` is the rational chain: each step is a capture on the square. The
	// occupancy it leaves is the piece of the last mover, and everything that
	// traded is gone.
	let last = null;
	for (const st of ex.steps) last = st;
	for (const st of ex.steps) if (st.from !== undefined) b.take(st.from);
	b.take(c.square);
	if (last && last.piece) b.set(c.square, last.piece);
	return b;
}

/** The board with one piece simply gone — the overload question. */
function without(board, p) { const b = board.clone(); b.take(p); return b; }

const count = { plies: 0, coupled: 0, overload: 0, byResolve: 0 };
const pairs = { n: 0, max: 0 };
const examples = [];
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			count.plies++;
			const board = pos.board;
			const chains = chainsOf(board, M.build(board));
			let coupled = 0, overload = false;

			// A: resolving one chain changes another's value.
			for (const a of chains) {
				let after = null;
				for (const b of chains) {
					if (a.square === b.square) continue;
					if (!after) after = resolved(board, a);
					if (!board.get(b.square)) continue;
					const now = M.seeValue(after, b.square, b.taker);
					if (now !== b.see) {
						coupled++;
						if (examples.length < 8 && p.id) examples.push(`${p.id}: resolving ${sq(a.square)} moves ${sq(b.square)} ${b.see}->${now}`);
					}
				}
			}
			if (coupled) count.byResolve++;
			pairs.n += coupled;
			pairs.max = Math.max(pairs.max, coupled);

			// B: the overload, measured properly. A defender guarding two squares
			// that are each HELD while it stays and lost when it goes.
			const duty = new Map();
			for (const c of chains) for (const d2 of c.defenders) {
				if (!duty.has(d2)) duty.set(d2, []);
				duty.get(d2).push(c);
			}
			for (const [p2, cs] of duty) {
				if (cs.length < 2) continue;
				const gone = without(board, p2);
				const lost = cs.filter((c) => c.see <= 0 && M.seeValue(gone, c.square, c.taker) > 0);
				if (lost.length >= 2) {
					overload = true;
					if (examples.length < 16 && p.id) examples.push(`${p.id}: ${sq(p2)} OVERLOADED on ${lost.map((c) => sq(c.square)).join('+')}`);
				}
			}
			if (overload) count.overload++;
			if (coupled || overload) count.coupled++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${n} (${(100 * n / count.plies).toFixed(1)}%)`;
console.log(`\n${P.length} puzzles · ${count.plies} solver plies\n`);
console.log(`  resolving one chain changes another  ${pc(count.byResolve)}`);
console.log(`  a defender is genuinely overloaded   ${pc(count.overload)}`);
console.log(`  either                               ${pc(count.coupled)}`);
console.log(`  coupled pairs: ${pairs.n} total, at most ${pairs.max} in one position\n`);
for (const x of examples) console.log('   ', x);
