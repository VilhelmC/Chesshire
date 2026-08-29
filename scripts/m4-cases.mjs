// Candidate positions for the primitives' unit tests, VERIFIED BEFORE THEY ARE
// WRITTEN DOWN.
//
// Two illegal hand-typed FENs have already cost this project a debugging session
// each. Nothing goes into a test file until this has parsed it and printed what
// the primitives actually say about it — then the assertions are written to
// match a position that demonstrably exists.
import { load } from './_ladder-lib.mjs';

const M = await load(`export { forks, mates, moves, hangs, costs, safeMoves, unsafe } from './src/domain/primitives';
export { pins, pinsOn, pinsCreated, pinsAgainstMover, pinsHeld, pinMark } from './src/domain/primitives/pin';
export { positionFromFen, fenOf } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

const CASES = [
	['knight forks king and rook', '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1'],
	['a pin: the knight cannot leave the d-file', '3k4/8/8/3n4/8/8/8/3RK3 b - - 0 1'],
	['NOT a pin: two men on the ray', '3k4/8/3p4/3n4/8/8/8/3RK3 b - - 0 1'],
	['NOT a pin: the KING is in front (that is check)', '3n4/8/8/3k4/8/8/8/3RK3 b - - 0 1'],
	['a would-be RELATIVE pin, which no longer ships', '3qk3/8/8/3n4/8/8/8/3RK3 b - - 0 1'],
	['a move that CREATES the pin', '3k4/8/8/3n4/8/8/8/K6R w - - 0 1'],
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
		`  drops:  ${drops.slice(0, 4).map(([u, c, un]) => `${u} -${c}${un.square === null ? ' (unringed)' : `@${M.makeSquare(un.square)}`}`).join('  ') || '(none)'}`,
	);
	const ps = M.pins(pos);
	console.log(`  pins:   ${ps.map((x) => `${M.makeSquare(x.shield)}<-${M.makeSquare(x.pinner)} (${x.colour}'s, king ${M.makeSquare(x.king)})`).join('   ') || '(none)'}`);
	if (ps.length) console.log(`  mark:   "${M.pinMark(ps[0]).note}"`);
	const makers = all.filter((m) => M.pinsCreated(pos, m).length);
	console.log(`  pinning moves: ${makers.map(nm).join(' ') || '(none)'}`);
}
process.exit(0);
