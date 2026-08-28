// IS WINNING MATERIAL ALWAYS BLUNDER, TRAPPED, OR COERCED?
//
// Will: "a piece is only capturable (with positive delta) in two possible
// scenarios: i) it can be attacked by a lower value piece (if defended) and has
// no escape options ii) escape options are strictly worse e.g. fork or skewer …
// It's not a full search on all trades."
//
// If that is right the material rungs need no search at all: a static SEE scan,
// a confinement test over <= 15 escape squares, and a match against the threats
// the higher rungs already produced.
//
// So: every ply where the ladder PROVES a forced material gain is classified.
//
//   BLUNDER  the gain is already there by SEE at the root — nothing to force
//   TRAPPED  after the answer move the target has no safe escape
//   COERCED  neither: the opponent is choosing to give it up
//
// The three are exhaustive by construction. The number that matters is the
// SPLIT, because BLUNDER needs no search whatever and TRAPPED needs a set-cover
// over a tiny universe.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'tri-')); const e = join(process.cwd(), '.tri.ts');
writeFileSync(e, `export { ladderChoose, settled } from './src/domain/ladder';
export { seeValue, V } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = M.makeSquare;
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const PR = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
const mk = (u) => { const m = { from: idx(u), to: idx(u.slice(2)) }; if (u[4]) m.promotion = PR[u[4]]; return m; };
const play = (p, m) => { const n = p.clone(); n.play(m); return n; };
const other = (c) => (c === 'white' ? 'black' : 'white');
const shifted = (b, f, t) => { const c = b.clone(); const p = c.take(f); if (!p) return c; c.take(t); c.set(t, p); return c; };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const cls = { mate: 0, blunder: 0, trapped: 0, coerced: 0 };
const byValue = {};
let plies = 0, forced = 0;

for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			plies++;
			let r; try { r = M.ladderChoose(pos, 3); } catch { break; }
			if (r.forced && r.moves.length) {
				forced++;
				if (r.value === 'mate') cls.mate++;
				else {
					const us = pos.turn, them = other(us);
					// BLUNDER: the swing is already available statically at the root.
					let best = 0;
					for (const s of pos.board[them]) { const v = M.seeValue(pos.board, s, us); if (Number.isFinite(v) && v > best) best = v; }
					if (best >= r.value) cls.blunder++;
					else {
						// TRAPPED: after the answer, some enemy man is attacked and has no
						// safe square to run to.
						const child = play(pos, r.moves[0]);
						let trapped = false;
						for (const t of child.board[them]) {
							const T = child.board.get(t);
							if (!T || T.role === 'king') continue;
							if (!(M.seeValue(child.board, t, us) > 0)) continue;
							const p2 = child.clone(); p2.turn = them;
							const dests = p2.allDests().get(t);
							const safe = dests ? [...dests].filter((f) => M.seeValue(shifted(child.board, t, f), f, us) <= 0) : [];
							if (!safe.length) { trapped = true; break; }
						}
						if (trapped) cls.trapped++; else cls.coerced++;
					}
					byValue[r.value] = (byValue[r.value] ?? 0) + 1;
				}
			}
		}
		try { pos = play(pos, mk(p.moves[i])); } catch { break; }
	}
}
const pc = (n) => `${((100 * n) / Math.max(1, forced)).toFixed(1)}%`;
console.log(`\n  ${plies} solver plies · ${forced} with a FORCED verdict (the rest fall to the exchange rung)\n`);
console.log(`    mate     ${String(cls.mate).padStart(4)}  ${pc(cls.mate)}`);
const mat = forced - cls.mate;
const pcm = (n) => `${((100 * n) / Math.max(1, mat)).toFixed(1)}%`;
console.log(`    material ${String(mat).padStart(4)}  ${pc(mat)}   of which:`);
console.log(`      BLUNDER  ${String(cls.blunder).padStart(4)}  ${pcm(cls.blunder)}   already there by SEE — no search needed at all`);
console.log(`      TRAPPED  ${String(cls.trapped).padStart(4)}  ${pcm(cls.trapped)}   set-cover over the escape squares`);
console.log(`      COERCED  ${String(cls.coerced).padStart(4)}  ${pcm(cls.coerced)}   Hall: the cheap branch of a forced choice`);
console.log(`\n    gains proved: ${Object.entries(byValue).sort((a,b)=>b[0]-a[0]).map(([v,n])=>`${v}cp x${n}`).join('  ')}`);
