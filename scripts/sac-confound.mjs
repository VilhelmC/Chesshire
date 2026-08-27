// Is `sacrifice` a class, or a proxy for a hard position?
//
// `pin-confound.mjs` is the standing lesson: a theme with a bad rate is a
// hypothesis about that theme, not about the mechanism its name suggests. A
// sacrifice puzzle is rated higher and has more pieces in play than an average
// one, and both of those make any evaluator worse for reasons that have nothing
// to do with giving material away.
//
// So the rate is split two ways at once — by RATING BAND and by OPTION-SET SIZE —
// and sacrifice is compared against everything else inside each. A gap that
// survives both is the theme. A gap that closes was difficulty all along.
//
// It also prints the easiest sacrifice failures with the position at the ply, so
// the hand-reading can start from the same run rather than a second one.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const POOL = Number(process.argv[2] ?? 400);
const SHOW = Number(process.argv[3] ?? 8);
const d = mkdtempSync(join(tmpdir(), 'sc-'));
const e = join(process.cwd(), '.sc-entry.ts');
writeFileSync(e, `export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { makeFen } from 'chessops/fen';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = M.makeSquare;

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).sort((a, b) => a.rating - b.rating).slice(0, POOL);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const band = (r) => (r < 800 ? '<800' : r < 1200 ? '800-1199' : r < 1600 ? '1200-1599' : '1600+');
const size = (n) => (n <= 8 ? '≤8' : n <= 16 ? '9-16' : '17+');

const rows = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	const sac = p.themes.includes('sacrifice');
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			let best, all;
			try { ({ best, all } = M.choose(pos, { arrivalHorizon: 3 })); } catch { continue; }
			const hit = best.length === 1 && best[0].from === want.from && best[0].to === want.to;
			const offered = all.some((x) => x.from === want.from && x.to === want.to);
			const answer = all.find((x) => x.from === want.from && x.to === want.to);
			const top = best[0];
			rows.push({
				id: p.id, ply: i, sac, rating: p.rating, hit, offered,
				band: band(p.rating), size: size(all.length),
				fen: M.makeFen(pos.toSetup()), want: p.moves[i], themes: p.themes.join(' '),
				chose: best.map((x) => sq(x.from) + sq(x.to)).join(' '),
				answerValue: answer?.value, topValue: top?.value, turn: pos.turn,
			});
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}

const show = (label, keys, pick) => {
	console.log(`\n  ${label}`);
	for (const k of keys) {
		const a = rows.filter((r) => pick(r) === k && r.sac);
		const b = rows.filter((r) => pick(r) === k && !r.sac);
		if (a.length < 8 || b.length < 8) continue;
		const f = (t) => (100 * t.filter((x) => x.hit).length) / t.length;
		console.log(
			`    ${k.padEnd(10)} sacrifice ${`${f(a).toFixed(1)}% of ${a.length}`.padEnd(18)} other ${`${f(b).toFixed(1)}% of ${b.length}`.padEnd(18)} ${(f(a) - f(b)).toFixed(1)}`,
		);
	}
};
console.log(`\n${rows.length} solver plies from the ${POOL} easiest puzzles`);
const all = (t) => (100 * t.filter((x) => x.hit).length) / t.length;
console.log(`  overall: sacrifice ${all(rows.filter((r) => r.sac)).toFixed(1)}% · other ${all(rows.filter((r) => !r.sac)).toFixed(1)}%`);
show('by RATING BAND', ['<800', '800-1199', '1200-1599', '1600+'], (r) => r.band);
show('by OPTION-SET SIZE', ['≤8', '9-16', '17+'], (r) => r.size);

console.log(`\n  the ${SHOW} easiest sacrifice failures — the answer is offered and outbid:\n`);
for (const r of rows.filter((x) => x.sac && !x.hit && x.offered).slice(0, SHOW)) {
	console.log(`    ${r.id} ply ${r.ply} (${r.rating})  ${r.turn} plays ${r.want}`);
	console.log(`      answer priced ${r.answerValue}   chosen ${r.chose} at ${r.topValue}`);
	console.log(`      ${r.fen}`);
	console.log(`      ${r.themes}\n`);
}
