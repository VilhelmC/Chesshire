// Does the price move the right way along a solution that is known to be right?
//
// The gate mixes two failures: an option set that does not name the move, and a
// price that ranks it below something else. Recall is measured directly; this
// measures the PRICE alone, and it does not depend on choosing anything.
//
// A puzzle's solution is a forced win for the solver, so along its line the
// price must not move away from the solver.
//
// COMPARED SAME-TURN, and the first version of this probe was not. It compared
// consecutive plies, which flips whose turn it is — and the turn is the one
// asymmetry the value has, since `tempiLeft` gives the side at stake one fewer
// tempo when the claimant moves first. Half of what it called a wrong-way move
// was the turn flipping. The comparison that means anything is ply i against ply
// i+2: the same player to move, two plies of the forced line apart.
//
// The expectation is NOT that the price improves. A claim the solver is about to
// collect is ALREADY in the price — that is the whole point of pricing a
// position rather than a move — so realising it should leave the number where it
// was. Unchanged is success. Only a move AWAY from the solver is an error.
//
// This is the one measurement in the project that needs no ranking, no tie-break
// and no option set. If it fails, nothing built on top can be right.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'lm-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, material } from './src/domain/complex';
export { traverse, say } from './src/domain/traverse';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const OPTS = { ...(ARR ? { arrivalHorizon: ARR } : {}), ...(process.env.HORIZON ? { horizon: Number(process.env.HORIZON) } : {}) };

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let solverPlies = 0, gained = 0, flat = 0, lost = 0;
let lines = 0, endsBetter = 0;
const worst = [];
void 0;
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	// The solver is whoever is to move at ply 1, NOT ply 0: the corpus is in
	// Lichess form, so `moves[0]` is the opponent's move and the solver replies.
	// Measured over 300 lines — the side moving at index 0 wins 8.0% of them, the
	// other side 83.3%. Value is from White's reference, so the solver's sign is
	// +1 for White and -1 for Black.
	const sign = pos.turn === 'white' ? -1 : 1;
	// Every position of the line, so pairs two apart can be compared.
	const seq = [{ pos, v: M.traverse(M.complex(pos, OPTS)).value }];
	for (let i = 0; i < p.moves.length; i++) {
		let next; try { next = play(seq[seq.length - 1].pos, p.moves[i]); } catch { break; }
		seq.push({ pos: next, v: M.traverse(M.complex(next, OPTS)).value });
	}
	// Solver-to-move positions are seq[1], seq[3], … — same turn, two plies apart.
	for (let i = 1; i + 2 < seq.length; i += 2) {
		solverPlies++;
		const delta = sign * (seq[i + 2].v - seq[i].v);
		if (delta > 0) gained++;
		else if (delta === 0) flat++;
		else {
			lost++;
			if (worst.length < 8)
				worst.push(`${p.id} ply ${i}  ${p.moves[i]} then ${p.moves[i + 1] ?? '-'}: price moved ${delta} AWAY (${seq[i].v} -> ${seq[i + 2].v})\n      ${M.makeFen(seq[i].pos.toSetup())}`);
		}
	}
	lines++;
	// Same-turn again: the last position with the solver to move, against the first.
	let last = seq.length - 1;
	if (last % 2 === 0) last--;
	if (last > 1 && sign * (seq[last].v - seq[1].v) > 0) endsBetter++;
}
const pc = (x, n) => `${((100 * x) / n).toFixed(1)}%`;
console.log(`\n${lines} lines, ${solverPlies} solver plies${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
console.log(`  two plies on, the price improved     : ${gained} (${pc(gained, solverPlies)})`);
console.log(`  held steady (already priced in)      : ${flat} (${pc(flat, solverPlies)})`);
console.log(`  moved AWAY from the solver           : ${lost} (${pc(lost, solverPlies)})`);
console.log(`\n  lines that end better than they start : ${endsBetter} (${pc(endsBetter, lines)})`);
console.log(`\n  Holding steady is SUCCESS: a claim about to be collected is already in`);
console.log(`  the price. Only the last line is an error, and it is the price's own`);
console.log(`  error rate — no ranking, no option set, no tie-break in it.\n`);
for (const x of worst) console.log(`  ${x}\n`);
