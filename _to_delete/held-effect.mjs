// What do the held rows actually change?
//
// A rule that moves no number is decoration. This asks the traversal twice — once
// with the held rows and once with them filtered out — and reports how often the
// value moves, in which direction, and on how many positions a piece was actually
// forced to choose which square to keep.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'he-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, held, material } from './src/domain/complex';
export { gamma } from './src/domain/gamma';
export { traverse, say } from './src/domain/traverse';
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

let n = 0, moved = 0, toWhite = 0, toBlack = 0, forced = 0, refused = 0;
const examples = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const c = M.complex(pos);
		const bare = { ...c, obligations: c.obligations.filter((o) => o.kind !== 'held') };
		const a = M.traverse(c), b = M.traverse(bare);
		if (a.refused) refused++;
		if (a.value !== b.value) {
			moved++;
			if (a.value > b.value) toWhite++; else toBlack++;
			if (examples.length < 6) examples.push(`${p.id} ply ${i}  ${b.value} -> ${a.value}\n      ${M.say(c, a)}\n      ${p.fen}`);
		}
		// A held row that the schedule could NOT keep: the crew went elsewhere.
		if (a.collected.some((o) => o.kind === 'held')) forced++;
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions`);
console.log(`  value moved            : ${moved} (${(100*moved/n).toFixed(1)}%)   toward White ${toWhite}, toward Black ${toBlack}`);
console.log(`  a hold had to be broken: ${forced} (${(100*forced/n).toFixed(1)}%)`);
console.log(`  refused (over MAX_ROWS): ${refused}`);
console.log(`\n  The two directions must BOTH appear, and roughly evenly: the rule is`);
console.log(`  symmetric, so a lopsided count is a bug in it and not a fact about chess.\n`);
for (const x of examples) console.log(`  ${x}\n`);
