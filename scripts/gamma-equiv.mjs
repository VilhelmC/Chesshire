// Does the symmetric Γ contain what the two role-parameter calls did?
//
// The same discipline as complex-equiv: a refactor of what gets BUILT has to be
// shown meaning-preserving before anything is built on top.
//
// The two differ in one intended way. `cover2.gamma` filtered by `tauStar` as it
// built; `gamma.ts` builds structurally and leaves the deadline comparison to
// the traversal. So the comparison filters the new edges by `tempiLeft` — which
// is `tauStar`'s arithmetic, stated where it belongs — and the sets must match.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ge-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex } from './src/domain/complex';
export { gamma as gammaNew, tempiLeft, coverable } from './src/domain/gamma';
export { gamma as gammaOld } from './src/domain/cover2';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };
let n = 0, same = 0, extra = 0, missing = 0;
const diffs = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const c = M.complex(pos);
		const now = M.gammaNew(c)
			.filter((x) => x.cost <= M.tempiLeft(c.obligations[x.obligation], c.turn))
			.map((x) => { const ob = c.obligations[x.obligation]; return `${sq(ob.square)}/${ob.claimant}|${x.kind}|${sq(x.piece)}>${sq(x.to)}@${x.cost}`; })
			.sort();
		const old = [];
		for (const owed of ['white', 'black']) {
			const g = M.gammaOld(pos, { owed });
			for (const x of g.edges) {
				const ob = g.E[x.obligation];
				old.push(`${sq(ob.square)}/${ob.claimant}|${x.kind}|${sq(x.piece)}>${sq(x.to)}@${x.cost}`);
			}
		}
		old.sort();
		const a = new Set(old), b = new Set(now);
		const onlyNew = [...b].filter((k) => !a.has(k)), onlyOld = [...a].filter((k) => !b.has(k));
		if (!onlyNew.length && !onlyOld.length) same++;
		else {
			extra += onlyNew.length; missing += onlyOld.length;
			if (diffs.length < 4) diffs.push({ id: p.id, i, onlyNew: onlyNew.slice(0, 4), onlyOld: onlyOld.slice(0, 4) });
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions · ${same} identical (${(100*same/n).toFixed(1)}%)`);
console.log(`  edges only in the symmetric Γ : ${extra}`);
console.log(`  edges only in the two-call Γ  : ${missing}`);
for (const x of diffs) console.log(`\n  DIFF ${x.id} ply ${x.i}\n    new: ${JSON.stringify(x.onlyNew)}\n    old: ${JSON.stringify(x.onlyOld)}`);
