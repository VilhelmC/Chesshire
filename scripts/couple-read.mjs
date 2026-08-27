// What couple.ts actually says. Read before anything is asserted about it.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'cr-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { chains, couplings, say, weight, parity, competesForTempo, overloaded } from './src/domain/couple';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const look = (label, pos) => {
	const b = pos.board;
	console.log(`\n=== ${label}`);
	for (const c of M.chains(b))
		console.log(`   chain ${sq(c.square)} ${c.owner} value=${c.value} len=${c.length} par=${M.parity(c)}` +
			` att=[${c.attackers.map(sq)}] def=[${c.defenders.map(sq)}]`);
	const cs = M.couplings(b);
	console.log(`   ${cs.length} coupling(s):`);
	for (const c of cs) console.log(`     [${c.kind}/${c.mechanism}] w=${M.weight(c)}  ${M.say(c, b)}`);
};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
for (const id of ['Uqazm', 'KSeRW', 'PxKx3', 'eCTH5']) {
	const p = P.find((x) => x.id === id);
	if (!p) { console.log(id, 'missing'); continue; }
	let pos = M.positionFromFen(p.fen);
	pos = play(pos, p.moves[0]);
	look(`${id} — solver to move`, pos);
}
look('two islands, sharing nothing', M.positionFromFen('r6r/8/4k3/8/8/8/8/RR3KRR w - - 0 1'));
look('bare kings', M.positionFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
look('king holding two pawns at once', M.positionFromFen('4k3/8/8/8/2n5/8/1P1P4/2K5 b - - 0 1'));
