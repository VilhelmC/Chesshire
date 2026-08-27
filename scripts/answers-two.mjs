// §3.1's "look hardest for the move that answers two" — does the traversal see it?
//
// `feasible()` matches each obligation to a distinct PIECE. But two obligations
// can be answered by the same MOVE — one piece, one destination, both rows gone —
// and the matching as written spends the piece on one of them and collects the
// other. That is a move the traversal cannot find, and §3.1 says it is the move
// that matters most.
//
// Measured before anything is built: how often does one (piece, to) edge in Γ
// discharge more than one live row of the same side, and how much material is
// being thrown away when it does?
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'a2-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, arrivals, isLive } from './src/domain/complex';
export { gamma, tempiLeft } from './src/domain/gamma';
export { traverse } from './src/domain/traverse';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let n = 0, positions = 0, doubles = 0, wasted = 0, maxWasted = 0;
const examples = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		n++;
		const base = M.complex(pos);
		const c = ARR ? { ...base, obligations: [...base.obligations, ...M.arrivals(pos.board, { arrivalHorizon: ARR })] } : base;
		const es = M.gamma(c);
		const t = M.traverse(c, es);
		if (t.refused) continue;

		// Every (piece, to) edge, and which rows it discharges within their deadline.
		const byMove = new Map();
		for (const x of es) {
			const row = c.obligations[x.obligation];
			if (x.cost > M.tempiLeft(row, c.turn)) continue;
			const k = `${x.piece}>${x.to}@${x.cost}`;
			const at = byMove.get(k) ?? { piece: x.piece, to: x.to, cost: x.cost, rows: new Set() };
			at.rows.add(x.obligation);
			byMove.set(k, at);
		}
		const collected = new Set(t.collected.map((r) => c.obligations.indexOf(r)));
		const scheduled = new Set(t.schedule.map((s) => s.obligation));
		let hit = false, lost = 0;
		for (const [, mv] of byMove) {
			if (mv.rows.size < 2) continue;
			doubles++;
			// The interesting case: the schedule collected a row that this ONE move
			// would have answered alongside one it did schedule.
			const rows = [...mv.rows];
			if (!rows.some((r) => collected.has(r)) || !rows.some((r) => scheduled.has(r))) continue;
			hit = true;
			for (const r of rows) if (collected.has(r)) lost += Number.isFinite(c.obligations[r].weight) ? c.obligations[r].weight : 10000;
		}
		if (hit) {
			positions++;
			wasted += lost;
			if (lost > maxWasted) maxWasted = lost;
			if (examples.length < 6) examples.push(`${p.id} ply ${i}  ${lost} thrown away\n      ${M.makeFen(pos.toSetup())}`);
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${n} positions${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
console.log(`  edges discharging two rows at once : ${doubles}`);
console.log(`  positions where the schedule threw one away : ${positions} (${(100*positions/n).toFixed(1)}%)`);
console.log(`  material thrown away, total / worst : ${wasted} / ${maxWasted}\n`);
for (const x of examples) console.log(`  ${x}\n`);
