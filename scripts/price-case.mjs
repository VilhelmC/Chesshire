// The worst price errors, in full, one at a time.
//
// Two aggregate cause tables have now been run over this and neither moved
// anything. `line-monotone` says 40.8% of same-turn pairs along a forced line
// move the price away from the solver; `price-why` says most of that is the
// price promising more than arrives. Neither says WHAT it promised.
//
// So: the worst cases, with everything printed — the rows at ply i, the rows two
// plies later, and the difference between them. Meant to be read, not summarised.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 3);
const SHOW = Number(process.argv[4] ?? 6);
const d = mkdtempSync(join(tmpdir(), 'pc-'));
const e = join(process.cwd(), '.pcase-entry.ts');
writeFileSync(e, `export { complex, material, isLive } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { gamma, tempiLeft } from './src/domain/gamma';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const rows = (pos) => {
	const c = M.complex(pos, OPTS);
	const t = M.traverse(c);
	const live = c.obligations.filter((r) => M.isLive(r, c.board));
	return { c, t, live };
};
const show = (label, pos) => {
	const { c, t, live } = rows(pos);
	console.log(`    ${label}  ${M.makeFen(pos.toSetup())}`);
	console.log(`      material ${M.material(pos.board)}  value ${t.value}  (${pos.turn} to move)`);
	for (const r of live)
		console.log(
			`        ${sq(r.square)}${r.from !== undefined ? '<' + sq(r.from) : ''} ${r.kind} w=${r.weight} dl=${r.deadline} for ${r.claimant} left=${M.tempiLeft(r, c.turn)}${t.collected.includes(r) ? '  COLLECTED' : ''}`,
		);
};

const cases = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	const solver = pos.turn === 'white' ? 'black' : 'white';
	const sign = solver === 'white' ? 1 : -1;
	const seq = [pos];
	for (const u of p.moves) { try { seq.push(play(seq[seq.length - 1], u)); } catch { break; } }
	for (let i = 1; i + 2 < seq.length; i += 2) {
		const a = M.traverse(M.complex(seq[i], OPTS)).value;
		const b = M.traverse(M.complex(seq[i + 2], OPTS)).value;
		if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
		const delta = sign * (b - a);
		if (delta < 0) cases.push({ id: p.id, i, delta, moves: [p.moves[i], p.moves[i + 1]], A: seq[i], C: seq[i + 2] });
	}
}
cases.sort((x, y) => x.delta - y.delta);
console.log(`\n${cases.length} pairs move the price away${ARR ? `, arrival horizon ${ARR}` : ''}. The ${SHOW} worst:\n`);
for (const x of cases.slice(0, SHOW)) {
	console.log(`  ${x.id} ply ${x.i}   ${x.moves[0]} ${x.moves[1]}   price moved ${x.delta}`);
	show('before', x.A);
	show('after ', x.C);
	console.log('');
}
