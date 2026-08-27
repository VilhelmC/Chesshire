// Does the symmetric complex contain exactly what the two asymmetric calls did?
//
// AMEND-0-SYMMETRIC removes the `owed` parameter. That is a refactor of what
// gets BUILT, so it has to be shown meaning-preserving before anything is built
// on top — the same check that made AMEND-1B safe, where the corpus number was
// unchanged across a change of semantics.
//
// The claim: obligations(board) == ledger(pos,'white') UNION ledger(pos,'black'),
// row for row, modulo the deleted `confidence` field.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ce-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { obligations, complex, fingerprint, material } from './src/domain/complex';
export { ledger } from './src/domain/ledger2';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const key = (r) => `${sq(r.square)}|${r.from !== undefined ? sq(r.from) : '-'}|${r.role}|${r.weight}|${r.deadline}|${r.claimant}|${r.kind}|${r.needs.slice().sort().join('.')}|${r.enablers.slice().sort().join('.')}`;

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
		const old = [...M.ledger(pos, 'white'), ...M.ledger(pos, 'black')].map(key).sort();
		const now = M.obligations(pos.board).map(key).sort();
		const a = new Set(old), b = new Set(now);
		const onlyNew = now.filter((k) => !a.has(k)), onlyOld = old.filter((k) => !b.has(k));
		if (!onlyNew.length && !onlyOld.length) same++;
		else {
			extra += onlyNew.length; missing += onlyOld.length;
			if (diffs.length < 5) diffs.push({ id: p.id, i, onlyNew: onlyNew.slice(0, 3), onlyOld: onlyOld.slice(0, 3) });
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions · ${same} identical (${(100*same/n).toFixed(1)}%)`);
console.log(`  rows only in the symmetric build : ${extra}`);
console.log(`  rows only in the two-call build  : ${missing}`);
for (const x of diffs) console.log(`\n  DIFF ${x.id} ply ${x.i}\n    new: ${JSON.stringify(x.onlyNew)}\n    old: ${JSON.stringify(x.onlyOld)}`);
