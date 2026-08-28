// DOES THE ENUMERATION GROW SLOWLY? — the load-bearing claim of the ladder.
//
// The ladder replaces a forward search over move sequences with a backward
// enumeration over CONFIGURATIONS: a man of ours, on a square it can reach in d.
// Forward search grows as b^d; configurations are bounded by men x squares.
//
// EXPECTED (offbook/FINDING-ENUMERATION-IS-FLAT.md, 280 solver plies):
//   branching factor mean 28.3
//   d=1  27 configs,  2.4 check   vs b^d          28
//   d=2  85 configs,  8.8 check   vs b^d         804
//   d=3 124 configs, 13.1 check   vs b^d      22,777
//   d=4 142 configs, 15.4 check   vs b^d     645,644
//   d=5 150 configs, 16.1 check   vs b^d  18,301,713
//   d=6 152 configs, 16.3 check   vs b^d 518,788,205
// It SATURATES at d=4. A re-run that does not saturate is a finding.
import { load, puzzles, play, other, mean, q } from './_ladder-lib.mjs';
const N = Number(process.argv[2] ?? 120), D = 6;
const M = await load(`export { reach } from './src/domain/reach';
export { positionFromFen } from './src/domain/chess';
export { attacks } from 'chessops/attacks';`);
const pat = Array.from({ length: D }, () => []), chk = Array.from({ length: D }, () => []), branch = [];
for (const p of puzzles(N)) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const us = pos.turn, king = pos.board.kingOf(other(us));
			let b = 0; for (const s of pos.allDests().values()) b += s.size();
			branch.push(b);
			if (king !== undefined) for (let dd = 1; dd <= D; dd++) {
				let n = 0, r = 0;
				for (const sq of pos.board[us]) {
					const pc = pos.board.get(sq);
					if (!pc || pc.role === 'king') continue;
					for (const [to, dist] of M.reach(pos.board, sq, { limit: dd }).dist) {
						if (dist < 1 || dist > dd) continue;
						n++;
						if (M.attacks(pc, to, pos.board.occupied.without(sq).with(to)).has(king)) r++;
					}
				}
				pat[dd - 1].push(n); chk[dd - 1].push(r);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
console.log(`\n${pat[0].length} solver plies\n  branching factor mean ${mean(branch).toFixed(1)}  median ${q(branch, 0.5)}\n`);
for (let dd = 1; dd <= D; dd++)
	console.log(`  d=${dd}  configurations ${mean(pat[dd-1]).toFixed(0).padStart(5)}  of which check ${mean(chk[dd-1]).toFixed(1).padStart(5)}   vs forward b^d ${Math.round(Math.pow(mean(branch), dd)).toLocaleString().padStart(12)}`);
