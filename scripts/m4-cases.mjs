// Candidate positions for the primitives' unit tests, VERIFIED BEFORE THEY ARE
// WRITTEN DOWN.
//
// Two illegal hand-typed FENs have already cost this project a debugging session
// each. Nothing goes into a test file until this has parsed it and printed what
// the primitives actually say about it — then the assertions are written to
// match a position that demonstrably exists.
import { load } from './_ladder-lib.mjs';

const M = await load(`export { forks, mates, moves, hangs, costs, safeMoves, unsafe } from './src/domain/primitives';
export { positionFromFen, fenOf } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

const CASES = [
	['knight forks king and rook', '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1'],
	['the forking man can simply be taken', '2rb2k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1'],
	['a fork of two pawns is not a fork', '7k/2p3p1/8/8/5N2/8/5PPP/6K1 w - - 0 1'],
	['mate in one, back rank', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'],
	['no mate — the king has luft', '6k1/5pp1/7p/8/8/8/5PPP/R5K1 w - - 0 1'],
	['promotion square held by a rook', '1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b - - 0 56'],
	['a hanging queen', '6k1/5ppp/8/3q4/3R4/8/5PPP/6K1 b - - 0 1'],
	['a pawn on the seventh', '6k1/4P3/8/8/8/8/5PPP/6K1 w - - 0 1'],
];

for (const [name, fen] of CASES) {
	console.log(`\n${'═'.repeat(72)}\n${name}\n  ${fen}`);
	let pos;
	try {
		pos = M.positionFromFen(fen);
	} catch (e) {
		console.log(`  ILLEGAL: ${e.message}`);
		continue;
	}
	console.log(`  reparsed: ${M.fenOf(pos)}`);
	const all = M.moves(pos);
	console.log(`  legal moves: ${all.length}`);
	console.log(`  mates:  ${M.mates(pos).map(nm).join(' ') || '(none)'}`);
	const fs = M.forks(pos);
	console.log(
		`  forks:  ${fs.map((f) => `${nm(f.move)} → ${f.targets.map(M.makeSquare).join('+')} (+${f.gain})`).join('   ') || '(none)'}`,
	);
	const safe = M.safeMoves(pos);
	console.log(`  safe:   ${safe.length}/${all.length}`);
	const drops = all
		.map((m) => [nm(m), M.costs(pos, m), M.unsafe(pos, m)])
		.filter(([, c]) => c > 0)
		.sort((a, b) => b[1] - a[1]);
	console.log(
		`  drops:  ${drops.slice(0, 6).map(([u, c, un]) => `${u} −${c}${un.square === null ? ' (unringed)' : `@${M.makeSquare(un.square)}`}`).join('  ') || '(none)'}`,
	);
}
process.exit(0);
