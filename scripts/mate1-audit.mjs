// Mate in one is the simplest case there is. Why is it not 100%?
//
// 98.9% offered, 82.0% outright — so the complex NAMES the mate and cannot say it
// is better than the alternatives. An ∞ row is supposed to be incomparable, so a
// tie at the top means either another move is also mate (a dual, and the harness
// counts a tie as a miss whatever it contains) or something that is NOT mate is
// being scored at ∞.
//
// Those want opposite fixes, so they are separated before either is attempted.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const POOL = Number(process.argv[2] ?? 1031);
const d = mkdtempSync(join(tmpdir(), 'm1-'));
const e = join(process.cwd(), '.m1-entry.ts');
writeFileSync(e, `export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = M.makeSquare;
const OPTS = { arrivalHorizon: 3 };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).sort((a, b) => a.rating - b.rating).slice(0, POOL);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

/** Truth, from the rules: does this move end the game? */
const isMate = (pos, from, to) => {
	const n = pos.clone();
	const p = pos.board.get(from);
	const pr = p?.role === 'pawn' && (to >> 3 === 0 || to >> 3 === 7);
	try { n.play(pr ? { from, to, promotion: 'queen' } : { from, to }); } catch { return false; }
	return n.isEnd() && n.isCheck();
};

let n = 0, outright = 0, tiedDual = 0, tiedFalse = 0, missed = 0, unoffered = 0, otherMate = 0;
const cases = [];
for (const p of P) {
	if (!p.themes.includes('mateIn1')) continue;
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		// A mateIn1 puzzle's solver ply is its last, and only that ply is mate in one.
		if (i > 0 && i % 2 === 1 && i === p.moves.length - 1) {
			n++;
			const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
			const { best, all } = M.choose(pos, OPTS);
			const hit = best.some((x) => x.from === want.from && x.to === want.to);
			if (!all.some((x) => x.from === want.from && x.to === want.to)) { unoffered++; continue; }
			if (hit && best.length === 1) { outright++; continue; }
			if (!hit) {
				// PLAYING A DIFFERENT MATE IS NOT A FAILURE. The puzzle names one answer;
				// several positions have more than one mate in one, and picking another
				// is correct play scored as a miss by a harness that compares strings.
				// Separated rather than folded in, because "chose a move that is not
				// mate" and "chose a different mate" want completely different work.
				if (best.length && best.every((x) => isMate(pos, x.from, x.to))) { otherMate++; continue; }
				missed++; cases.push(['MISSED', p, i, pos, best, want]); continue;
			}
			// A tie CONTAINING the answer. Are the others mate too?
			const others = best.filter((x) => x.from !== want.from || x.to !== want.to);
			const allMate = others.every((x) => isMate(pos, x.from, x.to));
			if (allMate) tiedDual++;
			else { tiedFalse++; cases.push(['FALSE-∞', p, i, pos, best, want]); }
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (k) => `${k} (${((100 * k) / n).toFixed(1)}%)`;
console.log(`\n${n} mate-in-1 solver plies\n`);
console.log(`  outright                          : ${pc(outright)}`);
console.log(`  tied, but EVERY co-top is mate    : ${pc(tiedDual)}   <- a dual; the puzzle has more than one answer`);
console.log(`  tied with something NOT mate      : ${pc(tiedFalse)}   <- a false ∞`);
console.log(`  chose a DIFFERENT mate in one     : ${pc(otherMate)}   <- correct play, scored as a miss`);
console.log(`  chose something that is not mate  : ${pc(missed)}`);
console.log(`  answer not offered                : ${pc(unoffered)}`);
console.log(`\n  PLAYS A MATE                      : ${(((outright + tiedDual + otherMate) * 100) / n).toFixed(1)}%`);
console.log(`  strictly the puzzle's answer      : ${((outright * 100) / n).toFixed(1)}%\n`);
for (const [tag, p, i, pos, best, want] of cases.slice(0, 12)) {
	const bad = best.filter((x) => !isMate(pos, x.from, x.to)).map((x) => sq(x.from) + sq(x.to));
	console.log(`  ${tag}  ${p.id} ply ${i} (${p.rating})  wanted ${p.moves[i]}  chose ${best.map((x) => sq(x.from) + sq(x.to) + '=' + x.value).join(' ')}`);
	console.log(`        not actually mate: ${bad.join(' ') || '—'}`);
	console.log(`        ${p.fen}  themes ${p.themes.join(' ')}`);
}
