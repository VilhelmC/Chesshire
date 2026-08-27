// Find a position where the cover answers the rows due NOW while a deferred row
// stays open — the case that separates `cover` over `due(g)` from `cover` over
// all of E. Searched rather than hand-built.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'fd-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, cover, due } from './src/domain/cover2';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e); // the entry has to sit in the repo root to resolve bare imports; it does not have to stay there
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let pos = M.positionFromFen(START), seed = 4242;
const rnd = (m) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
for (let n = 0; n < 12000; n++) {
	const moves = [];
	for (const from of pos.board[pos.turn]) for (const to of pos.dests(from)) moves.push({ from, to });
	if (!moves.length) { pos = M.positionFromFen(START); continue; }
	const mv = moves[rnd(moves.length)];
	const pr = pos.board.get(mv.from)?.role === 'pawn' && (mv.to >> 3 === 0 || mv.to >> 3 === 7);
	pos = pos.clone(); pos.play(pr ? { ...mv, promotion: 'queen' } : mv);
	for (const owed of ['white', 'black']) {
		const g = M.gamma(pos, { owed });
		const c = M.cover(g);
		if (!c.move) continue;
		const dueSet = new Set(M.due(g));
		if (dueSet.size === 0 || dueSet.size === g.E.length) continue;
		// A deferred row that this move does NOT carry a cost-1 edge for.
		const open = g.E.map((_, i) => i).filter((i) => !dueSet.has(i) &&
			!g.edges.some((x) => x.obligation === i && x.cost === 1 && x.piece === c.move.from && x.to === c.move.to));
		if (!open.length) continue;
		console.log(M.makeFen(pos.toSetup()), '| owed=' + owed,
			'| cover=' + M.makeSquare(c.move.from) + M.makeSquare(c.move.to),
			'| due=' + [...dueSet].map((i) => M.makeSquare(g.E[i].square)).join(','),
			'| open=' + open.map((i) => M.makeSquare(g.E[i].square) + '@τ' + g.tau[i]).join(','));
		process.exit(0);
	}
}
console.log('none found');
