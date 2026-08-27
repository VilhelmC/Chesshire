// How wrong is a distance measured on a frozen board?
//
// FORMALISM.md §5 admits the approximation and does not size it: "computed on a
// frozen board, which is an approximation in both directions — routes open and
// routes close". DEFICIENCY.md §8 says this is where the judgement lives. So
// before anything is built on `reach`, here is the number.
//
// Method: on every solver ply of the corpus, take each piece of the side to
// move and measure its distance to every enemy-occupied square. Then play the
// ply that actually happens and measure again from the same square, for pieces
// that did not themselves move. The difference is the drift a one-ply-old
// distance carries.
//
// Stockfish is not consulted, and should not be: this asks whether a geometric
// claim survives one ply of real play, which is a fact about the board.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d0 = mkdtempSync(join(tmpdir(), 'dr-'));
const e = join(d0, 'e.ts');
writeFileSync(e, `export { reach, distance } from ${JSON.stringify(join(process.cwd(),'src/domain/reach.ts'))};
export { positionFromFen, makeSquare, parseSquare } from ${JSON.stringify(join(process.cwd(),'src/domain/chess.ts'))};`);
const o = join(d0, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
  const mv = { from: M.parseSquare(u.slice(0,2)), to: M.parseSquare(u.slice(2,4)) }; if (pr) mv.promotion = pr; n.play(mv); return n; };

const ALL = JSON.parse(readFileSync('src/data/labPuzzles.json','utf8')).slice(0, N);
const drift = new Map(); const bump = (k) => drift.set(k, (drift.get(k) ?? 0) + 1);
let pairs = 0, opened = 0, closed = 0, wasReachable = 0, becameUnreachable = 0, becameReachable = 0;

for (const p of ALL) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		const uci = p.moves[i];
		let next; try { next = play(pos, uci); } catch { break; }
		const movedFrom = M.parseSquare(uci.slice(0,2));
		const mover = pos.turn;
		// Targets worth asking about: where the enemy actually stands.
		const targets = [...pos.board[mover === 'white' ? 'black' : 'white']];
		for (const from of pos.board[mover]) {
			if (from === movedFrom) continue;              // it moved; not the same journey
			if (!next.board.get(from)) continue;           // it was captured
			// Limit 7 with results only counted up to 4: a piece at the edge of the
			// horizon that drifts one square further must register as "+1", not as
			// "unreachable". Measuring to the same depth you report at turns the
			// horizon itself into a finding.
			const before = M.reach(pos.board, from, { limit: 7 });
			const after = M.reach(next.board, from, { limit: 7 });
			for (const t of targets) {
				const still = next.board.get(t);
				if (!still) continue;                        // the target itself went away
				// A target CAPTURED by the moving side is now one of our own pieces, so
				// it is unreachable by rule rather than by geometry. Counting that as a
				// route closing would have inflated the headline by more than half.
				if (still.color !== (mover === 'white' ? 'black' : 'white')) continue;
				const a = M.distance(before, t), b = M.distance(after, t);
				if (a > 4 && b > 4) continue;                // both beyond the reporting horizon
				pairs++;
				if (a === Infinity && b === Infinity) continue;
				if (a === Infinity || a > 4) { becameReachable++; bump('opened from beyond'); continue; }
				wasReachable++;
				if (b === Infinity || b > 4) { becameUnreachable++; bump('closed past the horizon'); continue; }
				if (b > a) { closed++; bump(`+${b - a}`); }
				else if (b < a) { opened++; bump(`${b - a}`); }
				else bump('0');
			}
		}
		pos = next;
	}
}
const pct = (n) => `${((100 * n) / wasReachable).toFixed(2)}%`;
console.log(`\n${ALL.length} puzzles · ${pairs} (piece, target) pairs · ${wasReachable} that had a finite distance\n`);
console.log(`unchanged after one ply : ${pct(wasReachable - opened - closed - becameUnreachable)}`);
console.log(`a route CLOSED (d grew) : ${pct(closed)}   plus ${pct(becameUnreachable)} that became unreachable`);
console.log(`a route OPENED (d fell) : ${pct(opened)}`);
console.log(`\ndrift distribution:`);
for (const [k, v] of [...drift].sort((a,b) => b[1]-a[1]).slice(0, 10)) console.log(`  ${String(v).padStart(7)}  ${k}`);
