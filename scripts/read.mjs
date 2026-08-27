// Read one position aloud: the rows, the schedule, the value. For hand-checking.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ARR = Number(process.env.ARR ?? 0);
const d = mkdtempSync(join(tmpdir(), 'rd-'));
const e = join(process.cwd(), '.read-entry.ts');
writeFileSync(e, `export { complex, material, isLive } from './src/domain/complex';
export { traverse, say } from './src/domain/traverse';
export { gamma, tempiLeft } from './src/domain/gamma';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};
for (const fen of process.argv.slice(2)) {
	const pos = M.positionFromFen(fen);
	const c = M.complex(pos, OPTS);
	const t = M.traverse(c);
	console.log(`\n${fen}`);
	console.log(`  material ${M.material(pos.board)}  ->  value ${t.value}`);
	for (const [i, r] of c.obligations.entries()) {
		if (!M.isLive(r, c.board)) continue;
		console.log(
			`    [${i}] ${sq(r.square)}${r.from !== undefined ? '<' + sq(r.from) : ''}${r.holder !== undefined ? '@' + sq(r.holder) : ''} ${r.kind} w=${r.weight} dl=${r.deadline} for ${r.claimant} left=${M.tempiLeft(r, c.turn)}`,
		);
	}
	for (const s of t.schedule)
		console.log(`    plan r${s.round} ${s.side}: ${sq(s.piece)}>${sq(s.to)} @${s.cost} answers ${sq(c.obligations[s.obligation].square)}`);
	console.log(`  collected: ${t.collected.map((r) => sq(r.square) + '/' + r.kind + '/' + r.weight).join(', ') || 'none'}`);
}
