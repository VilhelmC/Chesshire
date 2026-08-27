// Why is anything tied?
//
// Will: "Ties should be impossible in puzzles (by definition), so it's probably
// a symptom of incorrect implementation of theory and not correctly building
// attack-contingency graph."
//
// So this stops theorising and looks at the tied plies and their solutions: what
// is the solution move DOING that the stack scores as equal to something else?
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'tw-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { concedes } from './src/domain/concede2';
export { gamma, due, classify2 } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { V, other, seeValue } from './src/domain/exchange';
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

const score = (pos, m) => {
	const taken = pos.board.get(m.to) ? M.V[pos.board.get(m.to).role] : 0;
	let next;
	try { next = pos.clone(); next.play({ from: m.from, to: m.to, promotion: (pos.board.get(m.from)?.role === 'pawn' && (m.to >> 3 === 0 || m.to >> 3 === 7)) ? 'queen' : undefined }); }
	catch { return null; }
	return { v: taken + M.concedes(next, next.turn).loss - M.concedes(next, M.other(next.turn)).loss, next, taken };
};

/** What does the solution move DO, in the stack's own vocabulary? */
function describe(pos, m) {
	const s = score(pos, m);
	if (!s) return 'illegal';
	const them = s.next.turn;
	const bits = [];
	if (s.taken) bits.push(`takes ${s.taken}`);
	const g = M.gamma(s.next, { owed: them });
	const mode = M.classify2(g, s.next.board, them);
	if (!Number.isFinite(M.concedes(s.next, them).loss)) bits.push('MATE');
	else if (M.due(g).length) bits.push(`they owe ${M.due(g).length} (${mode})`);
	// Does it hang something of mine?
	const mineLoss = M.concedes(s.next, M.other(them)).loss;
	if (mineLoss > 0) bits.push(`hangs ${mineLoss}`);
	if (!bits.length) bits.push('nothing the stack can name');
	return bits.join(', ');
}

let plies = 0;
const buckets = {};
const samples = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const want = p.moves[i].slice(0, 4);
			const ms = [];
			for (const from of pos.board[pos.turn]) for (const to of pos.dests(from)) ms.push({ from, to: Number(to) });
			const scored = ms.map((m) => ({ uci: sq(m.from) + sq(m.to), m, s: score(pos, m) })).filter((x) => x.s);
			if (!scored.length) continue;
			const top = Math.max(...scored.map((x) => x.s.v));
			const best = scored.filter((x) => x.s.v === top);
			if (best.length < 2) continue;
			const inTie = best.some((x) => x.uci === want);
			const key = `${inTie ? 'answer IN tie' : 'answer BELOW tie'} · ${top === 0 ? 'tied at zero' : 'tied at ' + top}`;
			buckets[key] = (buckets[key] ?? 0) + 1;
			if (samples.length < 14) {
				const sol = scored.find((x) => x.uci === want);
				samples.push(`${p.id} [${p.themes.join(',')}]\n      tie of ${best.length} at ${top}: ${best.slice(0, 5).map((x) => x.uci).join(' ')}` +
					`\n      solution ${want}: ${describe(pos, sol ? sol.m : { from: 0, to: 0 })}` +
					`\n      a rival  ${best.find((x) => x.uci !== want)?.uci}: ${describe(pos, best.find((x) => x.uci !== want).m)}`);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${plies} solver plies\n`);
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('\n  samples:\n');
for (const s of samples) console.log('   ', s, '\n');
