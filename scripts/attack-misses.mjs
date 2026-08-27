// The long-attack failures, listed by puzzle id so they can be reviewed by hand.
//
// ---------------------------------------------------------------------------
// Will: "give me a set of example puzzle codes from the long attacks category so
// I can review manually what is actually going wrong."
//
// The filter is deliberately narrow. A ply qualifies when the chain does not find
// it, no loosening of the chain fixes it, the position is NOT an endgame — those
// are the other family, and they need the king term rather than review — and
// Stockfish separates the puzzle's move from the chain's choice by at least two
// pawns. What comes out is the set where something is going wrong that is neither
// horizon nor arithmetic.
//
// Usage: node scripts/attack-misses.mjs [puzzles] > attack-misses.txt
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 120);
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));
const ENDGAME = /endgame|pawnEndgame|rookEndgame|knightEndgame|bishopEndgame|queenEndgame|zugzwang/;

const dir = mkdtempSync(join(tmpdir(), 'am-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { chainMoves, CHAIN_STATS } from ${JSON.stringify(join(process.cwd(), 'src/domain/chain.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { chainMoves, CHAIN_STATS, positionFromFen, parseSquare, makeSquare } = await import(outfile);

const uci = (m) =>
	`${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? (m.promotion[0] === 'k' ? 'n' : m.promotion[0]) : ''}`;
const play = (pos, u) => {
	const n = pos.clone();
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	n.play(promo ? { from, to, promotion: promo } : { from, to });
	return n;
};

const LETTER = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
function fenOf(pos) {
	const rows = [];
	for (let r = 7; r >= 0; r--) {
		let row = '';
		let gap = 0;
		for (let f = 0; f < 8; f++) {
			const piece = pos.board.get(r * 8 + f);
			if (!piece) {
				gap++;
				continue;
			}
			if (gap) row += gap;
			gap = 0;
			const ch = LETTER[piece.role];
			row += piece.color === 'white' ? ch.toUpperCase() : ch;
		}
		if (gap) row += gap;
		rows.push(row);
	}
	return `${rows.join('/')} ${pos.turn === 'white' ? 'w' : 'b'} - - 0 1`;
}

function evalMove(fen, mv, depth = 16) {
	if (!ENGINE) return Promise.resolve(null);
	return new Promise((resolve) => {
		const proc = spawn(ENGINE);
		let out = '';
		const timer = setTimeout(() => {
			proc.kill();
			resolve(null);
		}, 20_000);
		proc.stdout.on('data', (c) => {
			out += c.toString();
			if (!out.includes('bestmove')) return;
			clearTimeout(timer);
			proc.kill();
			let cp = null;
			for (const l of out.split('\n')) {
				const m = /score (cp|mate) (-?\d+)/.exec(l);
				if (m) cp = m[1] === 'mate' ? (Number(m[2]) > 0 ? 10000 : -10000) : Number(m[2]);
			}
			resolve(cp);
		});
		proc.stdin.write(`uci\nisready\nposition fen ${fen}\ngo depth ${depth} searchmoves ${mv}\n`);
	});
}

function verdict(pos, want, perMove, opts) {
	const { scored } = chainMoves(pos, perMove, opts);
	if (!scored.length) return { v: 'missed', chose: null };
	const top = scored[0].score;
	const played = scored.find((s) => uci(s.move) === want);
	const ties = scored.filter((s) => s.score === top).length;
	return {
		v: !played || played.score !== top ? 'missed' : ties <= 2 || scored.length <= 1 ? 'found' : 'tied',
		chose: uci(scored[0].move),
		ties,
	};
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const found = [];
let puzzles = 0;

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [id, fen, movesStr, rating, , , , themes] = csv;
	if (ENDGAME.test(themes ?? '')) continue;
	const mv = movesStr.split(' ');
	if (mv.length < 4) continue; // "long" means a real sequence

	let pos;
	try {
		pos = positionFromFen(fen);
	} catch {
		continue;
	}
	const at = [];
	let ok = true;
	for (const u of mv) {
		at.push(pos);
		try {
			pos = play(pos, u);
		} catch {
			ok = false;
			break;
		}
	}
	if (!ok) continue;
	puzzles++;

	for (let i = 1; i < mv.length; i += 2) {
		for (const k of Object.keys(CHAIN_STATS)) CHAIN_STATS[k] = 0;
		const a = verdict(at[i], mv[i], 60_000, {});
		if (a.v === 'found') continue;
		const stops = { ...CHAIN_STATS };

		const posFen = fenOf(at[i]);
		const A = await evalMove(posFen, mv[i]);
		const B = a.chose ? await evalMove(posFen, a.chose) : null;
		if (A === null || B === null || A - B < 200) continue;

		const f = { id, i, rating, themes, posFen, want: mv[i], chose: a.chose, A, B, stops, v: a.v };
		found.push(f);
		// Printed as it is found: the first version printed everything at the end,
		// so stopping it early threw away an hour of work.
		console.log(`https://lichess.org/training/${f.id}   ply ${f.i}   rated ${f.rating}`);
		console.log(`  ${f.posFen}`);
		console.log(
			`  puzzle plays ${f.want} (engine ${f.A}); chain ${f.v}, chose ${f.chose} (engine ${f.B}) — gap ${f.A - f.B}cp`,
		);
		console.log(
			`  chain stopped: ${f.stops.settledWide} on a wide reply set, ${f.stops.settledQuiet} with nothing coercive, ${f.stops.plyCap} at the ply cap`,
		);
		console.log(`  themes: ${f.themes}\n`);
	}
	process.stderr.write(`\r${puzzles} puzzles, ${found.length} kept`);
}
process.stderr.write('\n');

console.log(`# ${found.length} long-attack failures from ${puzzles} non-endgame puzzles`);
