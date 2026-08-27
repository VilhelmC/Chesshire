// Would an invasion row see anything where the detector currently sees nothing?
//
// §1's table has carried `invasion` as named-absent since CHECKPOINT-M3: "an
// edge to the target, cost = the attacker's distance, weight = the SEE on
// arrival". `cover2.bear(p, S)` already computes that distance — it was built
// for the defensive direction in M4.
//
// Asked before building: on the plies where the stack is blind, does a row like
// that exist at all, and how many are there? A row that fires everywhere is not
// a row, and a row that fires nowhere is not worth the code.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'ip-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, bear, due } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { reach } from './src/domain/reach';
export { V, other, seeValue } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { attacks as attacksOf } from 'chessops/attacks';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
/** Does the piece standing on `from` attack `to` on this board? */
const bears = (b, from, to) => {
	const q = b.get(from);
	return !!q && M.attacksOf(q, from, b.occupied).has(to);
};

/**
 * Invasion rows the `owed` side faces: an enemy piece arriving to bear on one
 * of theirs, where the exchange there becomes positive once it does.
 */
function invasions(pos, owed, horizon = 4) {
	const board = pos.board, taker = M.other(owed);
	const out = [];
	for (const t of board[owed]) {
		const prize = board.get(t);
		if (!prize || prize.role === 'king') continue;
		const now = M.seeValue(board, t, taker);
		if (now > 0) continue; // already an immediate row; not an invasion
		for (const p of board[taker]) {
			const r = M.reach(board, p, { limit: horizon });
			const k = M.bear(board, p, t, r);
			if (k < 1 || k > horizon) continue;
			// The SEE ON ARRIVAL, actually computed.
			//
			// The first version of this probe pushed a row here with a comment
			// SAYING it evaluated the exchange and code that did not. It was
			// measuring "an enemy can reach this and it cannot run" and reporting
			// it as an invasion. Rule 5, and the third time this session an
			// instrument claimed more than it computed.
			//
			// The arrival square is the one at distance k from which p attacks t,
			// so it has to be found rather than assumed — `bear` returns the
			// distance and not the square.
			let best = null;
			for (const [to, dist] of r.dist) {
				if (dist !== k) continue;
				const b = board.clone();
				const pc = b.take(p);
				if (!pc) continue;
				b.take(to);
				b.set(to, pc);
				if (!M.reach(b, to, { limit: 1 }).dist.has(t) && !bears(b, to, t)) continue;
				const v = M.seeValue(b, t, taker);
				if (v > 0 && (best === null || v > best)) best = v;
			}
			if (best === null) continue;
			out.push({ square: t, from: p, k, was: now, becomes: best });
			break;
		}
	}
	return out;
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let plies = 0, blind = 0, blindWithInv = 0, allWithInv = 0, allTrapped = 0, blindTrapped = 0;
const sizes = [];
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const me = pos.turn, them = M.other(me);
			const gMe = M.gamma(pos, { owed: me });
			const gThem = M.gamma(pos, { owed: them });
			const isBlind = M.due(gMe).length === 0 && M.due(gThem).length === 0;
			const inv = invasions(pos, them);
			// The condition §1's table does not state, and which Γ supplies: an
			// invasion is only an obligation if the target cannot simply LEAVE
			// within the same k tempi. A piece with k moves to walk away owes
			// nothing, and a row that fires on every reachable piece is noise —
			// 99.4% of plies, which is the same shape as the `threaten` candidate
			// rule at 0.95x lift and the contested-square coupling at 92.7%.
			const trapped = inv.filter((r) => {
				const walk = M.reach(pos.board, r.square, { limit: 1 });
				for (const [to, dist] of walk.dist) {
					if (dist !== 1) continue;
					const b = pos.board.clone();
					const pc = b.take(r.square);
					if (!pc) continue;
					b.take(to);
					b.set(to, pc);
					if (M.seeValue(b, to, M.other(them)) <= 0) return false; // it can leave
				}
				return true;
			});
			sizes.push(trapped.length);
			if (inv.length) allWithInv++;
			if (trapped.length) allTrapped++;
			if (isBlind) { blind++; if (inv.length) blindWithInv++; if (trapped.length) blindTrapped++; }
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
sizes.sort((a, b) => a - b);
console.log(`\n${P.length} puzzles · ${plies} solver plies\n`);
console.log(`  plies where NOTHING is due either side : ${blind} (${(100*blind/plies).toFixed(1)}%)`);
console.log(`  ...of those, an invasion row exists    : ${blindWithInv} (${blind ? (100*blindWithInv/blind).toFixed(1) : 0}% of them)`);
console.log(`  plies with any invasion row at all     : ${allWithInv} (${(100*allWithInv/plies).toFixed(1)}%)`);
console.log(`\n  with the "it cannot simply leave" condition:`);
console.log(`  plies with a surviving invasion row    : ${allTrapped} (${(100*allTrapped/plies).toFixed(1)}%)`);
console.log(`  ...on blind plies                      : ${blindTrapped} (${blind ? (100*blindTrapped/blind).toFixed(1) : 0}% of them)`);
console.log(`  rows per ply after the condition: median ${sizes[sizes.length>>1]}, max ${sizes[sizes.length-1]}`);
