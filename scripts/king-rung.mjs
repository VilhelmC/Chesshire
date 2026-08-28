// THE KING RUNG, VALIDATED AGAINST GROUND TRUTH — and the M1/M2 gate.
//
// SPEC (what the theory says the rung IS):
//   d=1  exists a move of ours after which the king has no legal move
//   d=2  exists a move of ours such that for EVERY reply, d=1 holds
// with flights tested at d-1 rather than by a one-ply safety test.
//
// ENUM (what the ladder actually computes): the same, restricted to RELEVANT
// moves — those whose man would, from its destination, bear on the king or a
// square adjacent to him. Relevance uses the piece that ARRIVES: a promotion is
// a different man, and `rRPBO`'s answer is g7g8=N.
//
// EXPECTED (offbook/CASES-KING-RUNG-VALIDATED.md):
//   mateIn1 60/60 YES, 60/60 contains the move, mean 1.03 answers
//   mateIn2 60/60 YES, 60/60 contains the move, mean 1.00 answers
//   spec vs enum on mateIn2: agree 60/60 exactly, moves 33.1 -> 10.4 (31%)
//   answer survives the filter: mateIn1 87/87, mateIn2 154/154, mateIn3 93/93
import { load, puzzles, play, promo } from './_ladder-lib.mjs';
const N = Number(process.argv[2] ?? 60);
const M = await load(`export { positionFromFen } from './src/domain/chess';
export { attacks, kingAttacks } from 'chessops/attacks';
export { makeSquare } from 'chessops/util';`);
const sq = M.makeSquare, idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const uci = (m) => sq(m.from) + sq(m.to);
const P = puzzles();
const allMoves = (p) => { const out = [];
	for (const [from, ds] of p.allDests()) { const pc = p.board.get(from); const last = pc.color === 'white' ? 7 : 0;
		for (const to of ds) {
			if (pc.role === 'pawn' && (to >> 3) === last) for (const pr of ['queen','rook','bishop','knight']) out.push({ from, to, promotion: pr });
			else out.push({ from, to }); } } return out; };
const after = (p, m) => { const n = p.clone(); n.play(m); return n; };
const zoneOf = (p) => { const k = p.board.kingOf(p.turn === 'white' ? 'black' : 'white');
	if (k === undefined) return null; const z = new Set([k]); for (const s of M.kingAttacks(k)) z.add(s); return z; };
const inZone = (p, m) => { const z = zoneOf(p); if (!z) return true; if (z.has(m.to)) return true;
	const was = p.board.get(m.from); const pc = m.promotion ? { color: was.color, role: m.promotion } : was;
	for (const a of M.attacks(pc, m.to, p.board.occupied.without(m.from).with(m.to))) if (z.has(a)) return true; return false; };
const relevant = (p) => allMoves(p).filter((m) => inZone(p, m));
const winK1 = (p, gen = allMoves) => gen(p).filter((m) => after(p, m).isCheckmate());
const winK2 = (p, gen = allMoves) => gen(p).filter((m) => { const qq = after(p, m); if (qq.isCheckmate()) return false;
	const r = allMoves(qq); return r.length > 0 && r.every((x) => winK1(after(qq, x), gen).length > 0); });

for (const [theme, fn, dd] of [['mateIn1', winK1, 1], ['mateIn2', winK2, 2]]) {
	const pool = P.filter((x) => x.themes.includes(theme)).slice(0, N);
	let yes = 0, has = 0, sizes = [];
	for (const p of pool) { let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		pos = play(pos, p.moves[0]); const out = fn(pos); sizes.push(out.length);
		if (out.length) yes++; if (out.some((m) => uci(m) === p.moves[1].slice(0, 4))) has++; }
	console.log(`  ${theme}  d=${dd}  n=${pool.length}   YES ${yes}   contains the move ${has}   mean answers ${(sizes.reduce((s,x)=>s+x,0)/sizes.length).toFixed(2)}`);
}
// spec vs enumeration, and the filter's soundness across depths
let agree = 0, tot = 0, allN = 0, relN = 0;
for (const p of P.filter((x) => x.themes.includes('mateIn2')).slice(0, N)) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	pos = play(pos, p.moves[0]); tot++;
	allN += allMoves(pos).length; relN += relevant(pos).length;
	const a = new Set(winK2(pos, allMoves).map(uci)), b = new Set(winK2(pos, relevant).map(uci));
	if (a.size === b.size && [...a].every((x) => b.has(x))) agree++;
}
console.log(`\n  spec vs enumeration on mateIn2: agree ${agree}/${tot}   moves ${(allN/tot).toFixed(1)} -> ${(relN/tot).toFixed(1)} (${((100*relN)/allN).toFixed(0)}%)`);
for (const theme of ['mateIn1', 'mateIn2', 'mateIn3']) {
	const pool = P.filter((x) => x.themes.includes(theme)).slice(0, 200);
	let n = 0, hit = 0; const miss = [];
	for (const p of pool) { let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		pos = play(pos, p.moves[0]); const w = p.moves[1];
		const m = { from: idx(w), to: idx(w.slice(2)) }; if (w[4]) m.promotion = promo[w[4]];
		n++; if (inZone(pos, m)) hit++; else if (miss.length < 5) miss.push(`${p.id} ${w}`); }
	console.log(`  ${theme.padEnd(8)} answer survives the filter: ${hit}/${n}${miss.length ? '   MISSED ' + miss.join(' ') : ''}`);
}
