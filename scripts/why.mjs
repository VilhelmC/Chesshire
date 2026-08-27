// One failure at a time: where does my line stop matching the engine's?
//
// ---------------------------------------------------------------------------
// Will: "opponent and player evaluation should be symmetric — it makes no sense
// that performance is worse on opponent moves. Analyse failures move by move and
// find out what is being missed in each one."
//
// A score cannot be debugged. This prints, for each failure, MY principal
// variation next to the ENGINE's, so the ply where the two beliefs part company
// is visible — and then reports what my model thinks is happening at that ply.
//
// Usage: node scripts/why.mjs [puzzles] [depth] [solver|opponent|both] [show]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 120);
const DEPTH = Number(process.argv[3] ?? 6);
const ROLE = process.argv[4] ?? 'both';
const SHOW = Number(process.argv[5] ?? 10);
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));

const dir = mkdtempSync(join(tmpdir(), 'why-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves, allMoves, obliging, immediate } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { see, V, other } from ${JSON.stringify(join(process.cwd(), 'src/domain/exchange.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, allMoves, obliging, immediate, see, V, other, positionFromFen, parseSquare, makeSquare } =
	await import(outfile);

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

function toMove(u) {
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	return promo ? { from, to, promotion: promo } : { from, to };
}
const play = (pos, u) => {
	const n = pos.clone();
	n.play(toMove(u));
	return n;
};

/** Engine score for one move, plus the line it expects after it. */
function askMove(fen, mv, depth = 14) {
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
			let pv = '';
			for (const l of out.split('\n')) {
				const m = /score (cp|mate) (-?\d+)/.exec(l);
				if (m) cp = m[1] === 'mate' ? (Number(m[2]) > 0 ? 10000 : -10000) : Number(m[2]);
				const p = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(l);
				if (p) pv = p[1].trim();
			}
			resolve({ cp, pv });
		});
		proc.stdin.write(`uci\nisready\nposition fen ${fen}\ngo depth ${depth} searchmoves ${mv}\n`);
	});
}

/**
 * Walk my line and the engine's together; report the first ply where they differ
 * and what my model says about that position.
 */
function diverge(pos, mine, theirs) {
	const a = mine.split(' ');
	const b = theirs.split(' ');
	let p = pos.clone();
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) {
			const legal = allMoves(p).map(uci);
			const ob = obliging(p).map(uci);
			return {
				ply: i + 1,
				fen: fenOf(p),
				mine: a[i],
				theirs: b[i],
				// The three questions that explain most divergences.
				theirsLegal: legal.includes(b[i]),
				theirsObliging: ob.includes(b[i]),
				theirsMaterial: legal.includes(b[i]) ? immediate(p, toMove(b[i])) : null,
			};
		}
		try {
			p = play(p, a[i]);
		} catch {
			return { ply: i + 1, fen: fenOf(p), mine: a[i], theirs: b[i], illegal: true };
		}
	}
	return null;
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const reasons = new Map();
let puzzles = 0;
let checked = 0;
let missed = 0;
let shown = 0;

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [, fen, movesStr, , , , , themes] = csv;
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
		const role = i % 2 === 1 ? 'solver' : 'opponent';
		if (ROLE !== 'both' && ROLE !== role) continue;

		const { scored } = scoreMoves(at[i], DEPTH);
		if (!scored.length) continue;
		const top = scored[0];
		const played = scored.find((s) => uci(s.move) === mv[i]);
		checked++;
		if (played && played.score === top.score) continue;

		const posFen = fenOf(at[i]);
		const A = await askMove(posFen, mv[i]);
		const B = await askMove(posFen, uci(top.move));
		if (!A || !B || A.cp === null || B.cp === null) continue;
		if (A.cp - B.cp <= 50) continue; // a tie, or my move is better — not a fault
		missed++;

		// Where does my line stop matching the engine's line for MY move?
		const myLine = (top.line ?? [top.move]).map(uci).join(' ');
		const d = diverge(at[i], myLine, B.pv);

		let reason;
		// A one-move line "agrees" with anything, so say so instead of pretending
		// the two beliefs matched.
		if ((top.line ?? []).length < 2) reason = 'my search stops after one move — no continuation believed';
		else if (!d) reason = 'lines agree to the end — the disagreement is in the leaf value';
		else if (d.illegal) reason = 'my line contains an illegal move';
		else if (!d.theirsLegal) reason = 'engine line diverges into a position I did not reach';
		else if (!d.theirsObliging) reason = `their reply was NOT in my move list (quiet, ${d.theirsMaterial ?? 0}cp)`;
		else reason = 'their reply was in my list — I mis-valued it';
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

		if (shown < SHOW) {
			shown++;
			console.log(`\n${posFen}    [${role}, ${themes}]`);
			console.log(`  played  ${mv[i]}   me:${played?.score ?? 'n/a'}  engine:${A.cp}`);
			console.log(`  I chose ${uci(top.move)}   me:${top.score}  engine:${B.cp}`);
			console.log(`    my line     : ${myLine}`);
			console.log(`    engine line : ${B.pv}`);
			if (d && !d.illegal) {
				console.log(
					`    diverge ply ${d.ply}: I play ${d.mine}, engine plays ${d.theirs}` +
						`  (legal:${d.theirsLegal} inMyList:${d.theirsObliging} material:${d.theirsMaterial})`,
				);
				console.log(`      at ${d.fen}`);
			}
			console.log(`    -> ${reason}`);
		}
	}
}

console.log(`\n\nplies checked ${checked}, real misses ${missed}\n`);
console.log('-- why my line and the engine line part company --');
for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(v).padStart(3)}  (${((v / missed) * 100).toFixed(0)}%)  ${k}`);
}
