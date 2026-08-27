// Read Γ before asserting anything about it. PLAN.md rule 4.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'gp-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, cover, concede, classify2, tauStar, bear } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e); // the entry has to sit in the repo root to resolve bare imports; it does not have to stay there
const sq = (s) => M.makeSquare(s);

const show = (label, fen, owed) => {
	const pos = M.positionFromFen(fen);
	const who = owed ?? pos.turn;
	const g = M.gamma(pos, { owed: who });
	console.log(`\n=== ${label}`);
	console.log(`    ${fen}   owed=${who} turn=${pos.turn}`);
	g.E.forEach((x, i) => console.log(`    e${i}  ${x.kind} ${sq(x.square)} w=${x.weight} τ=${x.deadline} τ*=${g.tau[i]} coverable=${g.coverable[i]}`));
	const byE = new Map();
	for (const x of g.edges) { if (!byE.has(x.obligation)) byE.set(x.obligation, []); byE.get(x.obligation).push(x); }
	for (const [i, xs] of byE) console.log(`    e${i} <- ` + xs.map((x) => `${x.kind}:${sq(x.piece)}->${sq(x.to)}@${x.cost}`).join(' '));
	const c = M.cover(g);
	console.log(`    cover: ${c.move ? sq(c.move.from) + '->' + sq(c.move.to) : 'NONE'}  uncovered=${c.uncovered.length}`);
	const k = M.concede(pos, g, who);
	console.log(`    concede: ${k.move ? sq(k.move.from) + '->' + sq(k.move.to) : 'none'}  loss=${k.loss}  worst=${k.worst ? sq(k.worst.square) : '-'}`);
	console.log(`    mode: ${M.classify2(g, pos.board, who)}`);
};

show('evade only: knight hit by a pawn', '4k3/8/8/8/1n6/P7/8/4K3 b - - 0 1', 'black');
show('rook checks down the file, king behind it', '3rk3/8/8/8/8/8/3B4/3K4 w - - 0 1', 'white');
