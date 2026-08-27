// When a hold is broken, WHY?
//
// A held row is collected only when its crew is spent elsewhere — that is the
// entire claim. If it is ever collected while its crew sits idle, the matching is
// failing for some other reason and the rule is measuring an artefact.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'hw-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex } from './src/domain/complex';
export { gamma } from './src/domain/gamma';
export { traverse } from './src/domain/traverse';
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

let broken = 0, spentElsewhere = 0, noEdge = 0, idle = 0;
const idleCases = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		const c = M.complex(pos);
		const es = M.gamma(c);
		const t = M.traverse(c, es);
		const used = new Set();
		for (const s of t.schedule) used.add(s.piece);
		for (const o of t.collected) {
			if (o.kind !== 'held') continue;
			broken++;
			const hold = es.find((x) => x.kind === 'hold' && c.obligations[x.obligation] === o);
			if (!hold) { noEdge++; continue; }
			if (used.has(o.holder)) spentElsewhere++;
			else {
				idle++;
				if (idleCases.length < 8) idleCases.push(`${p.id} ply ${i}  ${sq(o.square)} weight ${o.weight} holder ${sq(o.holder)} — it was not used\n      ${p.fen}`);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\nholds broken            : ${broken}`);
console.log(`  crew spent elsewhere  : ${spentElsewhere}`);
console.log(`  no hold edge at all   : ${noEdge}`);
console.log(`  crew sat idle (SUSPECT): ${idle}\n`);
for (const x of idleCases) console.log(`  ${x}\n`);
