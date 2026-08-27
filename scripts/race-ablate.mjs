// Does the promotion-race term help? Ask the engine about the plies it changed.
//
// ---------------------------------------------------------------------------
// Turning the term on moved the whole-chain count from 815 clean to 796. That
// number cannot answer the question, because "the puzzle's move is no longer
// top-scoring" and "the detector is now wrong" are different claims: in a lost
// position several moves lose, the puzzle's continuation is only Stockfish's
// pick among them, and preferring a different one is not an error.
//
// So this runs every ply twice — with the term and without — keeps only the
// plies where the two DISAGREE, and puts each of those to the engine. A ply
// counts as fixed if the term made the detector's choice match the engine's
// judgement, and as broken if it did the reverse. Everything else is a tie
// between losing moves and belongs in neither column.
//
// Any single term can be ablated this way; the flag to switch off is the fourth
// argument, and it is the name of one of `Opts` in resolve.ts.
//
// Usage: node scripts/race-ablate.mjs [puzzles] [depth] [maxAdjudications] [flag]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 400);
const DEPTH = Number(process.argv[3] ?? 4);
const MAX_ADJ = Number(process.argv[4] ?? 80);
const FLAG = process.argv[5] ?? 'noRace';
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));
if (!ENGINE) {
	console.error('no stockfish — this script is nothing without an adjudicator');
	process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'race-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, positionFromFen, parseSquare, makeSquare } = await import(outfile);

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

/** Engine score for one specific move. */
function evalMove(fen, mv, depth = 14) {
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

/** The detector's choice, and whether the played move is among the best. */
function ask(pos, played, opts) {
	const { scored } = scoreMoves(pos, DEPTH, undefined, undefined, opts);
	if (!scored.length) return { hit: false, choice: null };
	const top = scored[0].score;
	return {
		hit: scored.some((s) => s.score === top && uci(s.move) === played),
		choice: uci(scored[0].move),
	};
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
let puzzles = 0;
let plies = 0;
const diffs = [];

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [id, fen, movesStr, , , , , themes] = csv;
	const mv = movesStr.split(' ');
	if (mv.length < 2) continue;

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

	for (let i = 1; i < mv.length; i++) {
		plies++;
		const on = ask(at[i], mv[i], {});
		const off = ask(at[i], mv[i], { [FLAG]: true });
		if (on.hit === off.hit && on.choice === off.choice) continue;
		diffs.push({ id, i, pos: at[i], played: mv[i], on, off, themes });
	}
	process.stderr.write(`\r${puzzles} puzzles, ${plies} plies, ${diffs.length} changed`);
}
process.stderr.write('\n');

console.log(`\n${puzzles} puzzles, ${plies} plies scored twice, ${diffs.length} plies changed by the term (${FLAG})\n`);

let fixed = 0;
let broke = 0;
let wash = 0;
const shown = [];

for (const d of diffs.slice(0, MAX_ADJ)) {
	const fen = fenOf(d.pos);
	// Three moves matter: the puzzle's, and each version's own choice.
	const [a, withRace, without] = await Promise.all([
		evalMove(fen, d.played),
		d.on.choice ? evalMove(fen, d.on.choice) : Promise.resolve(null),
		d.off.choice ? evalMove(fen, d.off.choice) : Promise.resolve(null),
	]);
	if (a === null || withRace === null || without === null) continue;
	// Loss against the puzzle's own move, under each setting.
	const lossOn = a - withRace;
	const lossOff = a - without;
	if (Math.abs(lossOn - lossOff) <= 50) wash++;
	else if (lossOn < lossOff) {
		fixed++;
		shown.push({ tag: 'FIXED', fen, ...d, lossOn, lossOff });
	} else {
		broke++;
		shown.push({ tag: 'BROKE', fen, ...d, lossOn, lossOff });
	}
}

console.log('-- adjudicated by the engine, on the plies the term changed --');
console.log(`  ${String(fixed).padStart(3)}  the term moved the choice TOWARDS the engine's`);
console.log(`  ${String(broke).padStart(3)}  the term moved it AWAY`);
console.log(`  ${String(wash).padStart(3)}  no material difference — losing either way`);

console.log('\n-- cases --');
for (const s of shown.slice(0, 14)) {
	console.log(`  ${s.tag}  ${s.fen}   [${s.id} ply ${s.i}, ${s.themes}]`);
	console.log(
		`     puzzle ${s.played}; with race ${s.on.choice} (loss ${s.lossOn}cp), without ${s.off.choice} (loss ${s.lossOff}cp)`,
	);
}
