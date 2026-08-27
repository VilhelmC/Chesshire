// How many rows does the ledger file, and are they doing anything?
//
// DEFICIENCY.md §4 predicted this failure in as many words:
//
//   "Raw Γ over-fires. Under §1's ledger, most squares in a middlegame carry
//    SOME prospective change, so a purely structural reading finds deficiency
//    everywhere and discriminates nothing — which is exactly the vacuous-pass
//    failure the Lab's `sharp` flag exists to expose."
//
// Reading the worst price errors, the ledger files thirteen live rows on a
// position with about three real facts — eight arrivals and four promotions of
// pawns five and six moves from a last rank, in positions decided in two.
//
// So: count them, and ablate the two horizons that generate them. A row that can
// be turned off without moving the gate is over-firing by the ablation standard,
// whatever it is worth in theory.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'rc-'));
const e = join(process.cwd(), '.rc-entry.ts');
writeFileSync(e, `export { complex, isLive } from './src/domain/complex';
export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const CONFIGS = [
	['promotion horizon 6 (current)', { arrivalHorizon: 3 }],
	['promotion horizon 4', { arrivalHorizon: 3, horizon: 4 }],
	['promotion horizon 3', { arrivalHorizon: 3, horizon: 3 }],
	['promotion horizon 2', { arrivalHorizon: 3, horizon: 2 }],
	['promotion horizon 1', { arrivalHorizon: 3, horizon: 1 }],
	['arrival horizon 2', { arrivalHorizon: 2 }],
	['arrival horizon 1', { arrivalHorizon: 1 }],
	['arrival 2, promotion 2', { arrivalHorizon: 2, horizon: 2 }],
];

console.log(`\n356 solver plies\n`);
console.log(`  ${'configuration'.padEnd(30)} ${'outright'.padStart(9)} ${'tie'.padStart(7)} ${'unoffered'.padStart(10)} ${'rows med/max'.padStart(13)}`);
for (const [name, opts] of CONFIGS) {
	let plies = 0, hit = 0, tie = 0, unoffered = 0;
	const counts = [];
	for (const p of P) {
		let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		for (let i = 0; i < p.moves.length; i++) {
			if (i > 0 && i % 2 === 1) {
				plies++;
				const c = M.complex(pos, opts);
				counts.push(c.obligations.filter((r) => M.isLive(r, c.board)).length);
				const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
				const { best, all } = M.choose(pos, opts);
				if (!all.some((x) => x.from === want.from && x.to === want.to)) unoffered++;
				const got = best.some((x) => x.from === want.from && x.to === want.to);
				if (got && best.length === 1) hit++;
				else if (got) tie++;
			}
			try { pos = play(pos, p.moves[i]); } catch { break; }
		}
	}
	counts.sort((a, b) => a - b);
	const pc = (x) => `${((100 * x) / plies).toFixed(1)}%`;
	console.log(
		`  ${name.padEnd(30)} ${pc(hit).padStart(9)} ${pc(tie).padStart(7)} ${pc(unoffered).padStart(10)} ${`${counts[counts.length >> 1]}/${counts[counts.length - 1]}`.padStart(13)}`,
	);
}
console.log('');
