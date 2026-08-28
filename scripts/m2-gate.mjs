// M2 GATE — the ladder's generator must change the COST and nothing else.
//
// M1 proved mate with the trivial generator: every legal move. This swaps in the
// attack-surface filter and checks two things:
//
//   1. NO ANSWER LOST. Not "the puzzle's move is still found" — the full SET of
//      first moves that force mate, computed both ways and compared. A filter
//      can drop one mate while another survives, and a test that only looks for
//      the corpus's answer would never see it. The comparison is against M1's
//      own output, so the generator is checked against the SPECIFICATION rather
//      than against the puzzle label.
//   2. Nodes down by roughly the measured factor.
//
// An answer is a root move after which the DEFENDER cannot survive — so it is
// read off `refuted` at the child, where the defender is the one to move.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 40);
const d = mkdtempSync(join(tmpdir(), 'm2-'));
const e = join(process.cwd(), '.m2-entry.ts');
writeFileSync(
	e,
	`export { solve } from './src/domain/pns';
export { mateGoal, allMoves, relevantMoves } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`,
);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);

const sq = M.makeSquare;
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const PR = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
const mk = (u) => {
	const m = { from: idx(u), to: idx(u.slice(2)) };
	if (u[4]) m.promotion = PR[u[4]];
	return m;
};
const play = (p, m) => {
	const n = p.clone();
	n.play(m);
	return n;
};
// UCI spells a knight 'n', not 'k'. Both sides of the comparison shared the
// error so the answer-set test stayed valid, but a printed disagreement would
// have named a king promotion.
const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const name = (m) => sq(m.from) + sq(m.to) + (m.promotion ? UCI[m.promotion] : '');

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));

/** Root moves after which the defender cannot survive, plus the nodes it cost. */
function answers(pos, depth, opts) {
	const attacker = pos.turn;
	const goal = M.mateGoal(attacker, opts);
	const cands = opts.narrow ? M.relevantMoves(pos, attacker === 'white' ? 'black' : 'white') : M.allMoves(pos);
	const found = [];
	let nodes = 0;
	for (const m of cands) {
		const r = M.solve(goal, play(pos, m), depth - 1);
		nodes += r.nodes;
		if (r.refuted) found.push(name(m));
	}
	return { set: new Set(found), nodes, cands: cands.length };
}

for (const [theme, plies] of [
	['mateIn1', 1],
	['mateIn2', 3],
	['mateIn3', 5],
]) {
	const pool = P.filter((x) => x.themes.includes(theme)).slice(0, N);
	let same = 0,
		lost = 0,
		gained = 0,
		n = 0;
	let nodesT = 0,
		nodesN = 0,
		candsT = 0,
		candsN = 0;
	const bad = [];
	for (const p of pool) {
		let pos;
		try {
			pos = M.positionFromFen(p.fen);
		} catch {
			continue;
		}
		pos = play(pos, mk(p.moves[0]));
		const t = answers(pos, plies, { narrow: false });
		const w = answers(pos, plies, { narrow: true, seed: true });
		n++;
		nodesT += t.nodes;
		nodesN += w.nodes;
		candsT += t.cands;
		candsN += w.cands;
		const missing = [...t.set].filter((x) => !w.set.has(x));
		const extra = [...w.set].filter((x) => !t.set.has(x));
		if (!missing.length && !extra.length) same++;
		else {
			if (missing.length) lost++;
			if (extra.length) gained++;
			if (bad.length < 4)
				bad.push(`${p.id}${missing.length ? ' LOST[' + missing.join(' ') + ']' : ''}${extra.length ? ' EXTRA[' + extra.join(' ') + ']' : ''}`);
		}
	}
	console.log(
		`  ${theme}  n=${String(n).padStart(3)}   answer sets identical ${String(same).padStart(3)}/${n}   lost ${lost}  gained ${gained}   ` +
			`root moves ${(candsT / n).toFixed(1)} -> ${(candsN / n).toFixed(1)}   nodes ${(nodesT / n).toFixed(0)} -> ${(nodesN / n).toFixed(0)}  (${(nodesT / Math.max(1, nodesN)).toFixed(1)}x fewer)`,
	);
	if (bad.length) console.log(`      DISAGREEMENTS: ${bad.join(' · ')}`);
}
