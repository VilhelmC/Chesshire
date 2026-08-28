// THEOREM: with opt-out recapture, the gain from an exchange never exceeds the
// value of the piece standing there.
//
//   v(t) = V(T) - max(0, their best continuation)   =>   v(t) <= V(T)
//
// because nobody recaptures into a loss. Will: "opponent cannot commit a queen to
// an exchange worth less. That's illegal." The only admissible excess is
// PROMOTION, which changes OUR material and is outside the exchange.
//
// This is what makes the ladder's descending rung order sound: if exchanges could
// win more than the piece on the square, there would be no valid ordering and the
// whole exclusion structure would collapse.
//
// EXPECTED (offbook/AMEND-RUNG-ORDER.md, 400 puzzles):
//   29,516 exchanges tested
//   v(t) > V(T)                       : 8  (0.027%)  — all on promotion ranks
//   v(t) > V(T) + promotion allowance : 0  (0.000%)
import { load, puzzles, play, other } from './_ladder-lib.mjs';
const N = Number(process.argv[2] ?? 400);
const M = await load(`export { seeValue, V } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const sq = M.makeSquare, PROMO = M.V.queen - M.V.pawn;
let tested = 0, overV = 0, overPromo = 0; const worst = [];
for (const p of puzzles(N)) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		for (const side of ['white', 'black']) for (const t of pos.board[other(side)]) {
			const T = pos.board.get(t);
			if (!T || T.role === 'king') continue;
			const v = M.seeValue(pos.board, t, side);
			if (!Number.isFinite(v)) continue;
			tested++;
			const rank = t >> 3;
			const promotable = (side === 'white' && rank === 7) || (side === 'black' && rank === 0);
			if (v > M.V[T.role]) { overV++;
				if (v > M.V[T.role] + (promotable ? PROMO : 0)) { overPromo++;
					if (worst.length < 6) worst.push(`${sq(t)} ${T.color}/${T.role} v=${v} V=${M.V[T.role]} promo=${promotable}`); } }
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n  ${tested.toLocaleString()} (square, side) exchanges tested`);
console.log(`  v(t) > V(T)                       : ${overV}  (${((100*overV)/tested).toFixed(3)}%)`);
console.log(`  v(t) > V(T) + promotion allowance : ${overPromo}  (${((100*overPromo)/tested).toFixed(3)}%)`);
console.log(worst.length ? '\n  COUNTEREXAMPLES:\n    ' + worst.join('\n    ') : '\n  no counterexample: the bound holds everywhere tested.');
