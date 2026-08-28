// What the unrolling says, read before anything is asserted about it.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'up-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { concedes, reckon, ladder, say, unroll, plays } from './src/domain/concede2';
export { concede, gamma, due } from './src/domain/cover2';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

function look(label, fen, owed) {
	const pos = M.positionFromFen(fen);
	const who = owed ?? pos.turn;
	const u = M.concedes(pos, who);
	const single = M.concede(pos, M.gamma(pos, { owed: who }), who);
	console.log(`\n=== ${label}   owed=${who}`);
	console.log(`   rows due: ${u.E.map((x) => `${sq(x.square)}=${x.weight}`).join(' ') || '—'}`);
	console.log(`   single-ply (M4): loss=${single.loss} move=${single.move ? sq(single.move.from)+sq(single.move.to) : '—'}`);
	console.log(`   unrolled  (M6): loss=${u.loss} move=${u.move ? sq(u.move.from)+sq(u.move.to) : '—'} line=[${u.line.map((x) => sq(x.square)).join('>')}]`);
	console.log(`   say: ${M.say(u)}`);
	const r = M.reckon(pos, who);
	if (r.ladder.rungs.length) console.log(`   ladder: ${r.ladder.rungs.map((x) => `${sq(x.threat.square)}=${x.threat.weight} over ${x.over}`).join(' | ')} stake=${r.ladder.stake} cycles=${r.ladder.cycles}`);
}

look('knight forks king and rook', '4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1', 'white');
look('knight forks two rooks', '4k3/2R3R1/4n3/8/8/8/8/4K3 w - - 0 1', 'white');
look('hanging rook, can run', '4k3/8/8/4r3/8/8/8/4RK2 b - - 0 1', 'black');
look('quiet start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
// Three loose pieces at once, which single-ply cannot express: one move saves
// one, they take the next, you save another, they take the last.
look('three loose pieces', '4k3/8/1r3r2/8/8/1R3R2/8/3rK3 w - - 0 1', 'white');
