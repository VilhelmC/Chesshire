// Is the gate's remaining loss concentrated in the lines that end in mate?
//
// `miss-why` says that where the graph named the answer and the price ranked it
// below something else, the answer is priced too LOW in 78% of cases and the
// rival too high in 4%. Something the solver's move is worth is not in the
// complex at all.
//
// §1's table still carries ONE row as unbuilt: mate-in-k. If that is what is
// missing, the gate should be much worse on the lines that end in mate than on
// the lines that end in material — and a sacrifice paid for by mate should be
// exactly the shape that reads as a pure loss.
//
// Split the same gate by that, on the same basis. No new machinery, no new claim.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'ms-'));
const e = join(process.cwd(), '.mate-entry.ts');
writeFileSync(e, `export { choose } from './src/domain/choose';
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

const box = { mate: { n: 0, hit: 0, tie: 0, unoffered: 0 }, material: { n: 0, hit: 0, tie: 0, unoffered: 0 } };
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	// Does the line end in mate? Played out once, before anything is measured.
	let end = pos, ok = true;
	for (const u of p.moves) { try { end = play(end, u); } catch { ok = false; break; } }
	if (!ok) continue;
	const bucket = end.isCheckmate() ? box.mate : box.material;

	let cur = pos;
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			bucket.n++;
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			const { best, all } = M.choose(cur, OPTS);
			if (!all.some((x) => x.from === want.from && x.to === want.to)) bucket.unoffered++;
			const hit = best.some((x) => x.from === want.from && x.to === want.to);
			if (hit && best.length === 1) bucket.hit++;
			else if (hit) bucket.tie++;
		}
		try { cur = play(cur, p.moves[i]); } catch { break; }
	}
}
const row = (name, b) =>
	console.log(
		`  ${name.padEnd(22)} ${String(b.n).padStart(5)} plies · outright ${((100 * b.hit) / (b.n || 1)).toFixed(1)}% · tie ${((100 * b.tie) / (b.n || 1)).toFixed(1)}% · answer not offered ${((100 * b.unoffered) / (b.n || 1)).toFixed(1)}%`,
	);
console.log(`\nsplit by how the line ends${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
row('ends in checkmate', box.mate);
row('ends in material', box.material);
console.log(
	`\n  §1's table carries mate-in-k as the one unbuilt row. If the gap between these`,
);
console.log(`  two buckets is large, that row is what the gate is missing.\n`);
