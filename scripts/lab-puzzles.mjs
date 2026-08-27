// Build the Lab's puzzle set, with each ply already marked solved or missed.
//
// ---------------------------------------------------------------------------
// The Lab needs to show two things: a puzzle the detector gets right, annotated
// so the reasoning can be read; and the ones it gets WRONG, so they can be
// judged by eye rather than taken on my word about whether they are out of
// scope.
//
// Only the pass/fail flag is precomputed — enough to filter on. The annotation
// itself is produced live in the browser by the same code the app ships, so what
// is on screen is the real output and not a recording of it.
//
// Usage: node scripts/lab-puzzles.mjs [perBucket] [depth] > src/data/labPuzzles.json
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PER = Number(process.argv[2] ?? 14);
const DEPTH = Number(process.argv[3] ?? 4);
// Matches the Lab's own ceiling (src/views/Lab.tsx). If these differ, the flags
// shipped in the JSON and the annotation computed in the browser disagree on
// exactly the positions where the search runs out — the hardest ones.
const BUDGET = 100_000;

const dir = mkdtempSync(join(tmpdir(), 'lab-'));
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

// A spread across the themes worth showing, and across difficulty.
const THEMES = [
	'hangingPiece', 'fork', 'pin', 'skewer', 'trappedPiece', 'discoveredAttack',
	'deflection', 'attraction', 'sacrifice', 'mateIn1', 'mateIn2', 'mateIn3',
	'backRankMate', 'promotion', 'advancedPawn', 'zugzwang', 'quietMove',
	'defensiveMove', 'intermezzo', 'clearance', 'doubleCheck', 'xRayAttack',
];
const band = (r) => (r < 1000 ? '<1000' : r < 1400 ? '1000-1399' : r < 1800 ? '1400-1799' : '1800+');

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const taken = new Map();
const out = [];
const seen = new Set();

for (const line of rows) {
	const csv = line.split('|').slice(2).join('|').split(',');
	const [id, fen, movesStr, ratingStr, , , , themesStr] = csv;
	if (seen.has(id)) continue;
	const themes = (themesStr ?? '').split(' ').filter(Boolean);
	const mine = themes.filter((t) => THEMES.includes(t));
	if (!mine.length) continue;

	// One bucket per (theme, band) so the set is spread rather than clumped.
	const buckets = mine.map((t) => `${t}|${band(Number(ratingStr))}`);
	if (!buckets.some((b) => (taken.get(b) ?? 0) < PER)) continue;

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

	// Score every ply of the chain, both sides — but only the SOLVER's plies
	// decide whether the puzzle counts as recovered.
	//
	// Will: "the discriminator really only has to hit the moves of the side that
	// is solving the puzzle. That, I think, is a general principle, because
	// opponent can have branches or degrees of freedom that don't change
	// outcome." Which is right, and it is a statement about the TEST rather than
	// about the evaluation: the puzzle's opponent replies are Stockfish's pick
	// among moves that may lose equally, so disagreeing with one is not evidence
	// of anything. The opponent plies are still scored and still shown — they are
	// just not counted.
	const plies = [];
	for (let i = 1; i < mv.length; i++) {
		const { scored } = scoreMoves(at[i], DEPTH, BUDGET);
		const solver = i % 2 === 1;
		if (!scored.length) {
			plies.push({ hit: false, ties: 0, legal: 0, solver, first: false, best: null });
			continue;
		}
		const top = scored[0].score;
		const ties = scored.filter((s) => s.score === top).length;
		const played = scored.find((s) => uci(s.move) === mv[i]);
		// Rank 1 after the coercion tie-break: material could not separate these
		// moves, but how much choice they leave the opponent could.
		const first = scored.length > 0 && uci(scored[0].move) === mv[i];
		plies.push({
			hit: played !== undefined && played.score === top,
			ties,
			legal: scored.length,
			solver,
			first,
			// The move the detector would actually play, so the Lab can show its
			// choice beside the puzzle's without recomputing the whole chain.
			best: uci(scored[0].move),
		});
	}
	const solverPlies = plies.filter((p) => p.solver);

	seen.add(id);
	for (const b of buckets) taken.set(b, (taken.get(b) ?? 0) + 1);
	out.push({
		id,
		fen,
		moves: mv,
		rating: Number(ratingStr),
		themes: mine,
		// Both judged over the solver's plies only.
		clean: solverPlies.every((p) => p.hit),
		// Every solver ply hit AND every hit was a real discrimination, not a
		// shrug. A ply with only one legal move discriminates nothing but cannot be
		// got wrong either, so it does not count against the puzzle.
		sharp: solverPlies.every((p) => p.hit && (p.ties <= 2 || p.legal <= 1)),
		// Every solver ply either discriminated on material, or was picked out of
		// the material tie by how much it coerces the opponent.
		firm: solverPlies.every((p) => p.hit && (p.ties <= 2 || p.legal <= 1 || p.first)),
		firstMiss: plies.findIndex((p) => p.solver && !p.hit),
		// Kept per ply so the Lab can colour the chain without recomputing it.
		plies: plies.map((p) => ({ h: p.hit ? 1 : 0, t: p.ties, l: p.legal, s: p.solver ? 1 : 0, f: p.first ? 1 : 0, b: p.best })),
	});
	process.stderr.write(`\r${out.length} kept`);
}

process.stderr.write(`\n${out.length} puzzles, ${out.filter((p) => p.clean).length} clean, ${out.filter((p) => p.sharp).length} sharp, ${out.filter((p) => p.firm).length} firm\n`);
writeFileSync('src/data/labPuzzles.json', JSON.stringify(out));
console.log(`wrote src/data/labPuzzles.json (${out.length} puzzles, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
