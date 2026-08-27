// Failures of the DETECTOR — the one the Lab shows — for manual review.
//
// ---------------------------------------------------------------------------
// The list this replaces was wrong, and wrong in a way worth writing down. It
// was produced by running `chainMoves` — the experimental coercion search — over
// the full 13,431-row puzzle sample, and then handed over as "example failures".
// Two things followed:
//
//   * Four of the fourteen ids were not in the Lab's 1031-puzzle set at all, so
//     they could not be opened.
//   * Seven of the rest are solved OUTRIGHT by the shipped detector. They are
//     failures of the chain, not of the thing on screen.
//
// The chain and the depth search are different objects — 84% against 91% on
// solver plies — and a list drawn from one is not a list of the other's
// problems. So this script draws from labPuzzles.json, which is the Lab's own
// set, scored by the shipped search: if a ply is listed here, it is listed on
// screen too, and the id opens.
//
// Usage: node scripts/detector-misses.mjs [max] [--tied]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX = Number(process.argv[2] ?? 40);
const WITH_TIES = process.argv.includes('--tied');
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));
const ENDGAME = /endgame|pawnEndgame|rookEndgame|knightEndgame|bishopEndgame|queenEndgame|zugzwang/;

const dir = mkdtempSync(join(tmpdir(), 'dm-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, positionFromFen, parseSquare, makeSquare } = await import(outfile);

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

const ALL = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
let kept = 0;
let scanned = 0;

console.log(`# Detector failures — from the Lab's own ${ALL.length} puzzles, scored by the shipped search\n`);

for (const p of ALL) {
	if (kept >= MAX) break;
	if (ENDGAME.test(p.themes.join(' '))) continue;
	// A solver ply the detector got wrong, or (with --tied) had no opinion on.
	const bad = p.plies
		.map((f, k) => ({ f, ply: k + 1 }))
		.filter(({ f }) => f.s && (!f.h || (WITH_TIES && f.t > 2 && f.l > 1)));
	if (!bad.length) continue;
	scanned++;

	let pos;
	try {
		pos = positionFromFen(p.fen);
	} catch {
		continue;
	}
	const at = [];
	let ok = true;
	for (const u of p.moves) {
		at.push(pos);
		try {
			pos = play(pos, u);
		} catch {
			ok = false;
			break;
		}
	}
	if (!ok) continue;

	for (const { f, ply } of bad) {
		if (kept >= MAX) break;
		const here = at[ply];
		if (!here) continue;
		const fen = fenOf(here);
		const want = p.moves[ply];
		const chose = f.b;
		const A = await evalMove(fen, want);
		const B = chose ? await evalMove(fen, chose) : null;
		if (A === null || B === null) continue;
		// Only a real disagreement counts: several moves may lose equally.
		if (A - B < 150) continue;

		const { scored } = scoreMoves(here, 4);
		const rank = scored.findIndex((s) => uci(s.move) === want) + 1;
		kept++;
		console.log(`https://lichess.org/training/${p.id}   ply ${ply}   rated ${p.rating}`);
		console.log(`  ${fen}`);
		console.log(
			`  puzzle plays ${want} (engine ${A}, detector ranks it ${rank}/${scored.length}); ` +
				`detector plays ${chose} (engine ${B}) — gap ${A - B}cp`,
		);
		console.log(`  themes: ${p.themes.join(' ')}\n`);
	}
}

console.log(`# ${kept} plies from ${scanned} puzzles with a failing solver ply`);
