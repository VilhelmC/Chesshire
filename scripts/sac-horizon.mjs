// HOW FAR AWAY IS THE COMPENSATION? — asked only of the sacrifices we miss.
//
// `theme-confound.mjs` stratified every theme by rating and by remaining solution
// plies, and only two survived as mechanism findings rather than difficulty in
// disguise:
//
//     sacrifice  +7.4% excess     clearance  +6.1%
//
// Everything else came in under +3%, and `quietMove` — the old WHERE-NEXT's joint
// top recommendation — came in at +0.8%, meaning its raw 14% rate was almost
// entirely rating and depth.
//
// So the hypothesis is licensed: a sacrifice gives material now for a payoff
// later, and the material rungs see two plies. This asks the follow-up as a
// NUMBER rather than a story:
//
//     at what depth does the puzzle's move overtake the one we picked?
//
// Only two moves are searched per position — theirs and ours — which is what
// makes depth affordable here at all. If the answer is 4, the tiebreak's trick
// (let the cheap pass choose what to search expensively) extends to candidate
// selection. If it is "not even at 4", no affordable search will do it and the
// compensation has to be RECOGNISED rather than found.
//
// Depth 6 was in the first version of this script and did not produce a single
// row in half an hour, which is its own answer about whether it could ship.
import { load, puzzles, play, mean, q } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 400);
const CAP = Number(process.argv[3] ?? 24);
const THEME = process.argv[4] ?? 'sacrifice';
const DEPTHS = [2, 4];

const M = await load(`export { ladderReport, holds, materialFor, allMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

const cases = [];
for (const p of puzzles(N)) {
	if (!p.themes.includes(THEME)) continue;
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			let r;
			try {
				r = M.ladderReport(pos, 5);
			} catch {
				r = null;
			}
			if (r && !r.moves.some((m) => nm(m).slice(0, 4) === p.moves[i].slice(0, 4))) {
				const want = M.allMoves(pos).find((m) => nm(m).slice(0, 4) === p.moves[i].slice(0, 4));
				if (want)
					cases.push({
						id: p.id,
						rating: p.rating,
						pos,
						want,
						pick: r.moves[0],
						left: p.moves.length - i,
						forced: r.forced,
					});
			}
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (cases.length >= CAP) break;
}

console.log(`\n  ${cases.length} ${THEME} plies the ladder misses`);
console.log(`  want/ours in centipawns against standing still\n`);

const flipAt = { 2: 0, 4: 0, never: 0 };
const lefts = [];
let ms = 0;
for (const c of cases) {
	const att = c.pos.turn;
	const base = M.materialFor(c.pos.board, att);
	lefts.push(c.left);
	let flip = 'never';
	const cells = [];
	for (const d of DEPTHS) {
		const t0 = Date.now();
		let a, b;
		try {
			a = M.holds(c.pos, c.want, att, d, -Infinity, Infinity) - base;
			b = M.holds(c.pos, c.pick, att, d, -Infinity, Infinity) - base;
		} catch {
			a = b = null;
		}
		ms += Date.now() - t0;
		const f = (x) => (x === null ? '?' : x === Infinity ? '+mate' : x === -Infinity ? '-mate' : String(x));
		cells.push(`${f(a).padStart(6)}/${f(b).padEnd(6)}`);
		if (flip === 'never' && a !== null && a >= b - 0.5) flip = d;
	}
	flipAt[flip]++;
	// Printed as it goes. The first version only spoke at the end and had to be
	// killed twice without ever saying anything.
	console.log(
		`  ${c.id} (${String(c.rating).padStart(4)}) left ${String(c.left).padStart(2)} ${c.forced ? 'forced' : 'unforc'} ` +
			`${nm(c.want)} vs ${nm(c.pick)}  d2 ${cells[0]} d4 ${cells[1]}  ` +
			`${flip === 'never' ? 'NOT BY d4' : 'flips at d' + flip}`,
	);
}

const n = Math.max(1, cases.length);
console.log(`\n  where the puzzle's move overtakes ours   (${(ms / n / 1000).toFixed(1)}s a position)\n`);
for (const d of DEPTHS) console.log(`    by depth ${d}    ${String(flipAt[d]).padStart(3)}  ${((100 * flipAt[d]) / n).toFixed(0)}%`);
console.log(`    not by 4     ${String(flipAt.never).padStart(3)}  ${((100 * flipAt.never) / n).toFixed(0)}%   ← beyond any affordable search`);
console.log(`\n  solution plies still to run: mean ${mean(lefts).toFixed(1)}  median ${q(lefts, 0.5)}  max ${Math.max(...lefts)}`);
