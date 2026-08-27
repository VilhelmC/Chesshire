// What the decomposition says. Read before anything is asserted — rule 4.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'cr-'));
const e = join(process.cwd(), '.clr-entry.ts');
writeFileSync(e, `export { clusters, valuesOf, priced, portfolio, say, sites } from './src/domain/cluster';
export { material } from './src/domain/complex';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
for (const fen of process.argv.slice(2)) {
	const pos = M.positionFromFen(fen);
	const cls = M.clusters(pos.board);
	console.log(`\n${fen}   (${pos.turn} to move)`);
	console.log(`  material ${M.material(pos.board)}  ·  portfolio ${M.portfolio(pos.board, pos.turn)}`);
	for (const cl of cls) {
		const v = M.valuesOf(pos.board, cl, pos.turn);
		console.log(
			`    cluster ${cl.sites.map((c) => sq(c.square)).join('+')}` +
				`  ${cl.sites.map((c) => `${sq(c.square)} ${c.value}->${v.get(c.square)}/${c.taker[0]}`).join('  ')}` +
				(cl.contested.length ? `   contested ${cl.contested.map(sq).join(',')}` : ''),
		);
	}
	console.log(`  ${M.say(pos.board, pos.turn)}`);
}
