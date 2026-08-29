// DO THE TWO IMPLEMENTATIONS AGREE? — run before the first one was deleted.
//
// ---------------------------------------------------------------------------
// The ablation collapsed the pin detector onto the absolute case, which is what
// `exchange.ts`'s `pinsFor` has found since the solver arc. Rewriting the
// primitive to wrap it removes a second copy of the same ray walk — but "the
// same geometry" is a claim, and this project has a rule about swapping an
// implementation on a claim.
//
// So both are run over every solver ply and the three men compared square by
// square. The original geometry is reproduced here rather than kept in the
// source: a control that lives in the file it is controlling is not one, and
// leaving dead code behind to be measured against is how a deletion stops being
// a deletion.
//
// EXPECTED: exact agreement. `pinsFor` and the ray walk both require one blocker
// between a slider and the king, and neither has any freedom beyond that. A
// disagreement means one of them is wrong, and the interesting case is a
// disagreement of ONE — which would be an edge (en passant, a king that is
// itself the blocker) rather than a difference of approach.
// ---------------------------------------------------------------------------
import { load, puzzles, play } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { pinsOn } from './src/domain/primitives/pin';
export { pinsFor, other, V } from './src/domain/exchange';
export { positionFromFen, fenOf } from './src/domain/chess';
export { makeSquare } from 'chessops/util';
export { attacks, between, ray } from 'chessops/attacks';
export { SquareSet } from 'chessops/squareSet';`);

const SLIDERS = new Set(['rook', 'bishop', 'queen']);

/** THE ORIGINAL, reproduced: the ray walk, filtered to the absolute case. */
function geometric(board, colour) {
	const out = [];
	const them = M.other(colour);
	for (const pinner of board[them]) {
		const piece = board.get(pinner);
		if (!piece || !SLIDERS.has(piece.role)) continue;
		const open = M.attacks(piece, pinner, M.SquareSet.empty());
		for (const target of board[colour].intersect(open)) {
			if (M.ray(pinner, target).isEmpty()) continue;
			const span = M.between(pinner, target);
			const blockers = span.intersect(board.occupied);
			if (blockers.size() !== 1) continue;
			const shield = blockers.first();
			if (shield === undefined || !board[colour].has(shield)) continue;
			const front = board.get(shield);
			const back = board.get(target);
			if (!front || !back) continue;
			if (front.role === 'king') continue;
			if (back.role !== 'king') continue; // the absolute case, which is all that survived
			out.push(`${pinner}|${shield}|${target}`);
		}
	}
	return out.sort();
}

const viaPinsFor = (board, colour) =>
	M.pinsOn(board, colour)
		.map((p) => `${p.pinner}|${p.shield}|${p.king}`)
		.sort();

let plies = 0;
let agreed = 0;
let pinsSeen = 0;
const differ = [];

for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		for (const colour of ['white', 'black']) {
			const a = geometric(pos.board, colour);
			const b = viaPinsFor(pos.board, colour);
			plies++;
			pinsSeen += a.length;
			if (JSON.stringify(a) === JSON.stringify(b)) agreed++;
			else if (differ.length < 8)
				differ.push(`${p.id} ${colour} ${M.fenOf(pos)}\n      ray walk: ${a.join(' ') || '(none)'}\n      pinsFor:  ${b.join(' ') || '(none)'}`);
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
}

console.log(`\n  ${plies} board-and-colour readings, ${pinsSeen} absolute pins found`);
console.log(`  agreement  ${agreed}/${plies}  ${((100 * agreed) / plies).toFixed(3)}%`);
if (differ.length) {
	console.log(`\n  DISAGREEMENTS — the swap is not safe:\n`);
	for (const d of differ) console.log(`    ${d}\n`);
} else {
	console.log(`\n  Exact. The ray walk was a second copy of pinsFor and is deleted.\n`);
}
process.exit(differ.length ? 1 : 0);
