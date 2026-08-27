// Why is a ply missed? Attribute it, do not guess.
//
// ---------------------------------------------------------------------------
// Will: "We know for a fact that any board position classified as a 'puzzle'
// must have a clear answer, which is always material — so what are we actually
// missing (checkmate is also material)?"
//
// He is right, and it rules out the explanation I gave. If the answer is a
// material difference then a search that cannot see it stopped before it. "The
// leaf has nothing to say" is not a property of material; it is a property of
// where I stopped looking.
//
// So this takes every solver ply the chain does not FIND and asks which
// loosening fixes it, one at a time:
//
//   width      never settle because the reply set is wide
//   depth      let the chain run to sixteen plies instead of eight
//   budget     five times the nodes
//   all        all three at once
//
// Anything that survives all four is a ply where a deeper, wider chain still
// sees no material difference — and THAT is the residue worth arguing about,
// with Stockfish asked what it thinks the difference is.
//
// Usage: node scripts/why-missed.mjs [puzzles]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 60);
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));

const dir = mkdtempSync(join(tmpdir(), 'wm-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { chainMoves, CHAIN_STATS } from ${JSON.stringify(join(process.cwd(), 'src/domain/chain.ts'))};
	 export { scoreMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { chainMoves, CHAIN_STATS, scoreMoves, positionFromFen, parseSquare, makeSquare } = await import(outfile);

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

/** found / tied / missed, and what the chain chose. */
function verdict(pos, want, perMove, opts) {
	const { scored } = chainMoves(pos, perMove, opts);
	if (!scored.length) return { v: 'missed', chose: null, gap: 0 };
	const top = scored[0].score;
	const played = scored.find((s) => uci(s.move) === want);
	const ties = scored.filter((s) => s.score === top).length;
	const v =
		!played || played.score !== top ? 'missed' : ties <= 2 || scored.length <= 1 ? 'found' : 'tied';
	return { v, chose: uci(scored[0].move), gap: played ? top - played.score : Infinity, ties };
}

const LOOSER = [
	['width', 60_000, { maxReplies: 99 }],
	['depth', 60_000, { plyCap: 16 }],
	['budget', 300_000, {}],
	['all', 300_000, { maxReplies: 99, plyCap: 16 }],
];

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const fixedBy = new Map();
const stubborn = [];
let puzzles = 0;
let plies = 0;
let base = { found: 0, tied: 0, missed: 0 };

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

	for (let i = 1; i < mv.length; i += 2) {
		plies++;
		for (const k of Object.keys(CHAIN_STATS)) CHAIN_STATS[k] = 0;
		const a = verdict(at[i], mv[i], 60_000, {});
		base[a.v]++;
		if (a.v === 'found') continue;
		const stops = { ...CHAIN_STATS };

		let cure = null;
		for (const [name, perMove, opts] of LOOSER) {
			if (verdict(at[i], mv[i], perMove, opts).v === 'found') {
				cure = name;
				break;
			}
		}
		if (cure) fixedBy.set(cure, (fixedBy.get(cure) ?? 0) + 1);
		else if (stubborn.length < 40) {
			stubborn.push({ id, i, themes, fen: fenOf(at[i]), want: mv[i], ...a, stops });
		}
	}
	process.stderr.write(`\r${puzzles} puzzles, ${plies} solver plies`);
}
process.stderr.write('\n');

console.log(`\n${puzzles} puzzles, ${plies} solver plies`);
console.log(`base chain: found ${base.found}, tied ${base.tied}, missed ${base.missed}\n`);
console.log('-- of the non-found plies, what fixes them --');
for (const [k, v] of [...fixedBy].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`  ${String(stubborn.length).padStart(3)}  nothing (looked at below)`);

console.log('\n-- the stubborn ones, with what the engine says the difference is --');
for (const s of stubborn.slice(0, 14)) {
	const A = await evalMove(s.fen, s.want);
	const B = s.chose ? await evalMove(s.fen, s.chose) : null;
	console.log(`  ${s.id} ply ${s.i}  ${s.fen}`);
	console.log(
		`    ${s.v}: wanted ${s.want}, chain chose ${s.chose} (${s.ties ?? '?'} tied)  engine: ${A} vs ${B}` +
			`   stops: wide ${s.stops.settledWide}, quiet ${s.stops.settledQuiet}, plyCap ${s.stops.plyCap}, budget ${s.stops.budget}  [${s.themes}]`,
	);
}
