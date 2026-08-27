// The gate, split by what the puzzle is ABOUT.
//
// Reading the six easiest failures by hand said five of them were mate, so the
// aggregate is being dragged by one theme. That is a claim worth a number before
// it is worth a mechanism — `pin-confound.mjs` is the standing reminder of what
// happens when a subset is named after a theory instead of before one.
//
// Themes come with the corpus. They were assigned by Lichess from the SOLUTION,
// not by me from the failure, which is what makes this split safe in the way the
// pin split was not.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const POOL = Number(process.argv[2] ?? 200);
const ARR = Number(process.argv[3] ?? 3);
const d = mkdtempSync(join(tmpdir(), 'ts-'));
const e = join(process.cwd(), '.ts-entry.ts');
writeFileSync(e, `export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const OPTS = { ...(ARR ? { arrivalHorizon: ARR } : {}) };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'))
	.sort((a, b) => a.rating - b.rating)
	.slice(0, POOL);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

/** Mate in how many of the solver's OWN moves, from this ply. Non-mate = null. */
const mateDepth = (p, i) => {
	if (!p.themes.some((t) => t.startsWith('mateIn') || t === 'mate')) return null;
	return Math.ceil((p.moves.length - i) / 2);
};

const rows = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			const { best, all } = M.choose(pos, OPTS);
			rows.push({
				mate: mateDepth(p, i),
				hit: best.length === 1 && best[0].from === want.from && best[0].to === want.to,
				tied: best.length > 1 && best.some((x) => x.from === want.from && x.to === want.to),
				off: all.some((x) => x.from === want.from && x.to === want.to),
			});
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}

const show = (label, t) => {
	if (!t.length) return;
	const f = (k) => `${((100 * k) / t.length).toFixed(1)}%`;
	console.log(
		`  ${label.padEnd(22)} ${String(t.length).padStart(4)} plies   outright ${f(t.filter((x) => x.hit).length).padStart(6)}   +tie ${f(
			t.filter((x) => x.hit || x.tied).length,
		).padStart(6)}   offered ${f(t.filter((x) => x.off).length).padStart(6)}`,
	);
};
console.log(`\n${rows.length} solver plies from the ${POOL} lowest-rated puzzles, arrival horizon ${ARR}\n`);
show('mate in 1', rows.filter((r) => r.mate === 1));
show('mate in 2', rows.filter((r) => r.mate === 2));
show('mate in 3+', rows.filter((r) => r.mate !== null && r.mate >= 3));
show('not a mate', rows.filter((r) => r.mate === null));
console.log('');
show('ALL', rows);
console.log(`\n  §1's mate row is the one row PLAN.md never built. If mate-in-1 is fine and`);
console.log(`  mate-in-k is not, the row exists implicitly at depth 1 — as "the king has`);
console.log(`  no discharge" — and has no deadline.\n`);
