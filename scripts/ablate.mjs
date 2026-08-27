// What is each mechanism actually carrying?
//
// Will: "I suspect you have made all this too complicated."
//
// Seven mechanisms have been added to the traversal and only two of them were
// ever measured against the gate. That is the real failure — not that the code is
// long, but that nobody can say which parts are load-bearing. So: turn each one
// off and measure, on the same basis, plus a FLOOR that uses none of it.
//
// The floor is deliberately stupid: of the same option set the graph names, take
// the move that maximises material-after minus the best single exchange the
// opponent can then win. Fifteen lines, no complex, no traversal, no rows. If the
// whole edifice is worth two points over that, the edifice is wrong.
//
// A mechanism that ablates to zero is complication and should be deleted.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ab-'));
const e = join(process.cwd(), '.ablate-entry.ts');
writeFileSync(e, `export { complex, material } from './src/domain/complex';
export { choose, options } from './src/domain/choose';
export { seeValue, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

/**
 * The floor. Same option set, no complex.
 *
 * Value of a move = material after it, minus the single best exchange the
 * opponent can win on the resulting board. One ply of SEE and nothing else.
 */
function floorChoose(pos, opts) {
	const c = M.complex(pos, opts);
	const opts2 = M.options(c, pos);
	const out = [];
	for (const op of opts2) {
		const next = pos.clone();
		const piece = pos.board.get(op.from);
		const promo = piece?.role === 'pawn' && (op.to >> 3 === 0 || op.to >> 3 === 7);
		try { next.play(promo ? { from: op.from, to: op.to, promotion: 'queen' } : { from: op.from, to: op.to }); } catch { continue; }
		const b = next.board;
		let worst = 0;
		for (const sq of b[pos.turn]) worst = Math.max(worst, M.seeValue(b, sq, next.turn));
		const sign = pos.turn === 'white' ? 1 : -1;
		out.push({ ...op, value: M.material(b) - sign * worst });
	}
	if (!out.length) return { best: [], all: out };
	const pick = (a, b) => (pos.turn === 'white' ? Math.max(a, b) : Math.min(a, b));
	const top = out.reduce((n, x) => pick(n, x.value), out[0].value);
	return { best: out.filter((x) => x.value === top), all: out };
}

const CONFIGS = [
	['full stack', { arrivalHorizon: 3 }, null],
	['— no arrival rows', {}, null],
	['— no serial press', { arrivalHorizon: 3, serialPress: false }, null],
	['— no §6 cluster pricing', { arrivalHorizon: 3, cluster: false }, null],
	['— none of the above', { serialPress: false, cluster: false }, null],
	['FLOOR: one ply of SEE', { arrivalHorizon: 3 }, floorChoose],
	['FLOOR, no arrival rows', {}, floorChoose],
];

console.log(`\n356 solver plies, same corpus, same option set unless stated\n`);
console.log(`  ${'configuration'.padEnd(26)} ${'outright'.padStart(9)} ${'tie'.padStart(7)} ${'unoffered'.padStart(10)}`);
for (const [name, opts, fn] of CONFIGS) {
	let plies = 0, hit = 0, tie = 0, unoffered = 0;
	for (const p of P) {
		let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		for (let i = 0; i < p.moves.length; i++) {
			if (i > 0 && i % 2 === 1) {
				plies++;
				const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
				const { best, all } = fn ? fn(pos, opts) : M.choose(pos, opts);
				if (!all.some((x) => x.from === want.from && x.to === want.to)) unoffered++;
				const got = best.some((x) => x.from === want.from && x.to === want.to);
				if (got && best.length === 1) hit++;
				else if (got) tie++;
			}
			try { pos = play(pos, p.moves[i]); } catch { break; }
		}
	}
	const pc = (x) => `${((100 * x) / plies).toFixed(1)}%`;
	console.log(`  ${name.padEnd(26)} ${pc(hit).padStart(9)} ${pc(tie).padStart(7)} ${pc(unoffered).padStart(10)}`);
}
console.log(`\n  frozen baseline (all legal moves, old stack): 57.6% outright, 25.8% tie\n`);
