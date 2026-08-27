// How often does each of §6's four couplings actually occur?
//
// Checkpoint B asks "are the four couplings the right four?" and that is an
// empirical question, so it gets a count before couple.ts gets a line. A kind
// that never fires is a finding about the theory; a kind that fires everywhere
// is a definition that is too broad to branch on.
//
// Rule 5: every definition below is stated in one place and counted from that
// statement, so the number and the meaning cannot drift apart.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'cc-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { build, on, isLive, blockedBy } from './src/domain/graph';
export { see, seeValue } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);

/** A square where both sides bear and something stands: an exchange can happen. */
function chainsOf(board, g) {
	const out = [];
	for (const s of board.occupied) {
		const w = M.on(g, s, 'white'), b = M.on(g, s, 'black');
		if (!w.length || !b.length) continue;
		const owner = board.get(s).color;
		const taker = owner === 'white' ? 'black' : 'white';
		out.push({ square: s, owner, defenders: owner === 'white' ? w : b,
			see: M.seeValue(board, s, taker), len: M.see(board, s, taker).steps.length });
	}
	return out;
}

const count = { positions: 0, anyChain: 0, defender: 0, defenderLive: 0, square: 0, squareTight: 0, xray: 0, xrayLive: 0, parity: 0 };
const hist = {};
const bump = (k) => (hist[k] = (hist[k] ?? 0) + 1);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			count.positions++;
			const board = pos.board, g = M.build(board);
			const chains = chainsOf(board, g);
			if (chains.length) count.anyChain++;
			const live = chains.filter((c) => c.see > 0);
			const chainSq = new Set(chains.map((c) => c.square));

			// 1. contested defender: one piece in the defender set of two chains.
			const duty = new Map();
			for (const c of chains) for (const d2 of c.defenders) duty.set(d2, (duty.get(d2) ?? 0) + 1);
			const dutyLive = new Map();
			for (const c of live) for (const d2 of c.defenders) dutyLive.set(d2, (dutyLive.get(d2) ?? 0) + 1);
			const nDef = [...duty.values()].filter((v) => v > 1).length;
			if (nDef) count.defender++;
			if ([...dutyLive.values()].some((v) => v > 1)) count.defenderLive++;
			bump(`def${Math.min(nDef, 4)}`);

			// 2. contested square: an EMPTY square gating two edges. Broad, then
			//    tightened to edges that terminate on a chain square — because a
			//    square gating two irrelevant rays couples nothing.
			const gates = new Map();
			for (const ed of g.edges) for (const n of ed.needs) {
				if (board.occupied.has(n)) continue;
				if (!gates.has(n)) gates.set(n, new Set());
				gates.get(n).add(ed.to);
			}
			if ([...gates.values()].some((s) => s.size > 1)) count.square++;
			const tight = [...gates.values()].filter((s) => [...s].filter((t) => chainSq.has(t)).length > 1);
			if (tight.length) count.squareTight++;

			// 3. x-ray: a blocked edge whose blocker is itself a chain square, so
			//    resolving that chain reveals the edge.
			let xr = 0, xrLive = 0;
			for (const ed of g.edges) {
				if (M.isLive(ed, board)) continue;
				for (const b of M.blockedBy(ed, board)) {
					if (chainSq.has(b)) xr++;
					if (live.some((c) => c.square === b)) xrLive++;
				}
			}
			if (xr) count.xray++;
			if (xrLive) count.xrayLive++;

			// 4. harvest parity: needs two chains AND a chain whose length exceeds
			//    one, since "where A stopped" has one answer otherwise.
			if (chains.length > 1 && chains.some((c) => c.len > 1)) count.parity++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${n} (${(100 * n / count.positions).toFixed(1)}%)`;
console.log(`\n${P.length} puzzles · ${count.positions} solver plies\n`);
console.log(`  any exchange square at all      ${pc(count.anyChain)}`);
console.log(`  1. contested defender           ${pc(count.defender)}`);
console.log(`       ...on chains that are live ${pc(count.defenderLive)}`);
console.log(`  2. contested square (broad)     ${pc(count.square)}`);
console.log(`       ...gating two chain squares${pc(count.squareTight)}`);
console.log(`  3. x-ray onto a chain square    ${pc(count.xray)}`);
console.log(`       ...onto a LIVE chain       ${pc(count.xrayLive)}`);
console.log(`  4. harvest parity possible      ${pc(count.parity)}`);
console.log(`\n  contested defenders per ply:`, JSON.stringify(hist));
