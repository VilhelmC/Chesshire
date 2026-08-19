// Repertoire tree construction — SPEC.md §4 steps 1-3.
//
// The tree branches. An earlier version walked a single five-ply line and
// treated every departure from it as a leaf, which meant we only ever looked at
// plies 1, 3 and 5 — where nobody blunders. Beginner mistakes live around moves
// 5-8, so the tree grows to TREE_MAX_PLIES and follows every popular reply.
//
// Two things happen at each opponent node, and they are deliberately
// INDEPENDENT:
//
//   * EXPANSION decides where the tree keeps growing (the most popular replies,
//     because that is where your games actually go).
//   * RECORDING lists every reply as a drill candidate, popular or not.
//
// Coupling them would be a serious bug. 5...Nxd5 in the Two Knights is both
// very common AND close to losing: expansion must follow it, and the drill
// sweep must still see it. Selecting drill candidates by "the moves we did not
// expand" would hide precisely the positions worth training.

import { CONFIG } from '../config';
import { fetchExplorer } from '../data/explorer';
import { analysePosition, toColourPov } from '../data/cloudEval';
import {
	MIN_GAMES,
	MIN_FREQ,
	D_SHALLOW,
	TREE_MAX_PLIES,
	TREE_EXPAND_TOP,
	TREE_MIN_MASS,
	TREE_MAX_NODES,
	OUR_MOVE_CANDIDATES,
	OUR_MOVE_MIN_FREQ,
	scoreForSideToMove,
} from './classify';
import { applyUci, playSanLine, positionKey, sideToMove, INITIAL_FEN } from './chess';
import type { Colour, ExplorerResponse } from './types';

export type TrunkNode = {
	ply: number;
	fen: string;
	key: string;
	path: string[];
	/** Probability a real game reaches this position, given our repertoire. */
	mass: number;
	toMove: Colour;
	gameCount: number;
	sparse: boolean;
	/** Our chosen move here, and why we chose it. */
	ourMove?: { uci: string; san: string; reason: string };
	/** True while still on the seed line the user specified. */
	onSeed: boolean;
};

export type Deviation = {
	id: string;
	fromKey: string;
	fromFen: string;
	path: string[];
	uci: string;
	san: string;
	frequency: number;
	mass: number;
	gameCount: number;
	scoreForOpponent: number;
	fen: string;
	averageRating?: number;
	/** True if our own preparation stops here rather than them surprising us. */
	terminal: boolean;
	/** Ply at which this move was played. */
	ply: number;
	/** True if the tree also continued through this move. */
	expanded: boolean;
};

export type BuildResult = {
	repertoireId: string;
	colour: Colour;
	trunk: TrunkNode[];
	deviations: Deviation[];
	dropped: Deviation[];
	trunkSurvivalMass: number;
	earlyDeviationMass: number;
	complete: boolean;
	warnings: string[];
	stats: { nodes: number; explorerCalls: number; evalCalls: number; maxPly: number };
};

export type BuildProgress = { step: number; label: string };

export type BuildOptions = {
	maxPlies?: number;
	maxNodes?: number;
	onProgress?: (p: BuildProgress) => void;
	shouldCancel?: () => boolean;
};

export class BuildCancelled extends Error {
	constructor() {
		super('build cancelled');
	}
}

export async function buildRepertoire(
	spec: { id: string; colour: Colour; line: string },
	opts: BuildOptions = {},
): Promise<BuildResult> {
	const maxPlies = opts.maxPlies ?? TREE_MAX_PLIES;
	const maxNodes = opts.maxNodes ?? TREE_MAX_NODES;

	const { ucis: seed } = playSanLine(spec.line);
	const warnings: string[] = [];
	const trunk: TrunkNode[] = [];
	const deviations: Deviation[] = [];
	const dropped: Deviation[] = [];
	const seen = new Set<string>();

	let complete = true;
	let explorerCalls = 0;
	let evalCalls = 0;
	let step = 0;
	let maxPly = 0;
	let seedEndMass = 0;

	const check = () => {
		if (opts.shouldCancel?.()) throw new BuildCancelled();
	};

	/** Pick our move: the most popular reply the engine does not dislike. */
	async function chooseOurMove(
		fen: string,
		ply: number,
	): Promise<{ uci: string; san: string; reason: string } | null> {
		// While the user's stated line still applies, it wins outright.
		if (ply < seed.length) {
			const uci = seed[ply];
			try {
				return { uci, san: applyUci(fen, uci).san, reason: 'your line' };
			} catch {
				return null;
			}
		}

		// Past the seed we invent the repertoire. Candidates are restricted to
		// moves people actually play: an engine move nobody plays leads to
		// positions the explorer has no data for, which starves everything
		// downstream.
		let data: ExplorerResponse;
		try {
			explorerCalls++;
			data = await fetchExplorer(fen);
		} catch (err) {
			warnings.push(`Explorer failed choosing our move at "${fen}": ${(err as Error).message}`);
			complete = false;
			return null;
		}

		const total = data.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0);
		const candidates = data.moves
			.map((m) => ({ m, freq: total ? (m.white + m.draws + m.black) / total : 0 }))
			.filter((c) => c.freq >= OUR_MOVE_MIN_FREQ)
			.slice(0, OUR_MOVE_CANDIDATES);

		if (!candidates.length) return null;

		let best: { uci: string; san: string; reason: string; cp: number } | null = null;
		for (const c of candidates) {
			const after = safeApply(fen, c.m.uci);
			if (!after) continue;
			evalCalls++;
			const a = await analysePosition(after, D_SHALLOW, 1);
			const cp = toColourPov(a.pvs[0]?.cpWhite ?? 0, spec.colour);
			if (!best || cp > best.cp) {
				best = {
					uci: c.m.uci,
					san: c.m.san,
					cp,
					reason: `best of the ${candidates.length} popular moves (${(c.freq * 100).toFixed(0)}% played, ${cp}cp)`,
				};
			}
		}

		return best ? { uci: best.uci, san: best.san, reason: best.reason } : null;
	}

	async function expand(fen: string, path: string[], mass: number, ply: number): Promise<void> {
		check();
		if (ply > maxPlies || trunk.length >= maxNodes || mass < TREE_MIN_MASS) return;

		const key = positionKey(fen);
		if (seen.has(key)) return; // transposition — already covered
		seen.add(key);

		const toMove = sideToMove(fen);
		const isOurs = toMove === spec.colour;
		maxPly = Math.max(maxPly, ply);

		const node: TrunkNode = {
			ply,
			fen,
			key,
			path: [...path],
			mass,
			toMove,
			gameCount: 0,
			sparse: false,
			onSeed: ply <= seed.length,
		};

		if (isOurs) {
			step++;
			opts.onProgress?.({ step, label: `our move after ${path.join(' ') || 'start'}` });

			const our = await chooseOurMove(fen, ply);
			node.ourMove = our ?? undefined;
			trunk.push(node);
			if (!our) return;

			const next = safeApply(fen, our.uci);
			if (next) await expand(next, [...path, our.san], mass, ply + 1);
			return;
		}

		// --- opponent to move --------------------------------------------------
		step++;
		opts.onProgress?.({ step, label: `their replies after ${path.join(' ') || 'start'}` });

		let data: ExplorerResponse;
		try {
			explorerCalls++;
			data = await fetchExplorer(fen);
		} catch (err) {
			warnings.push(`Explorer failed at "${path.join(' ') || 'start'}": ${(err as Error).message}`);
			complete = false;
			trunk.push(node);
			return;
		}

		const total = data.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0);
		node.gameCount = total;
		node.sparse = total < MIN_GAMES;
		trunk.push(node);

		if (node.sparse) {
			warnings.push(
				`Sparse data after "${path.join(' ') || 'start'}" — ${total} games in band; not expanded further.`,
			);
			return;
		}

		const rows: Deviation[] = data.moves.map((m): Deviation => {
			const games = m.white + m.draws + m.black;
			const frequency = total ? games / total : 0;
			const after = safeApply(fen, m.uci);
			return {
				id: `${key}|${m.uci}`,
				fromKey: key,
				fromFen: fen,
				path: [...path],
				uci: m.uci,
				san: m.san,
				frequency,
				mass: frequency * mass,
				gameCount: games,
				scoreForOpponent: scoreForSideToMove(toMove, m),
				fen: after ?? fen,
				averageRating: m.averageRating,
				terminal: false,
				ply,
				expanded: false,
			};
		});

		// EXPANSION: follow the most popular replies. This is about coverage.
		const toExpand = rows
			.filter((r) => r.mass >= TREE_MIN_MASS)
			.sort((a, b) => b.frequency - a.frequency)
			.slice(0, TREE_EXPAND_TOP);
		const expandIds = new Set(toExpand.map((r) => r.id));

		// RECORDING: every reply is a drill candidate, expanded or not.
		for (const r of rows) {
			r.expanded = expandIds.has(r.id);
			r.terminal = ply >= seed.length && !r.expanded;
			if (r.frequency >= MIN_FREQ) deviations.push(r);
			else dropped.push(r);
		}

		for (const r of toExpand) {
			const next = safeApply(fen, r.uci);
			if (next) await expand(next, [...path, r.san], r.mass, ply + 1);
		}
	}

	try {
		await expand(INITIAL_FEN, [], 1, 0);
	} catch (err) {
		if (!(err instanceof BuildCancelled)) throw err;
		complete = false;
		warnings.push('Build cancelled before completion.');
	}

	// Mass still on our seed line when it runs out — how often we get our opening.
	const seedNode = trunk.find((n) => n.ply === seed.length);
	seedEndMass = seedNode?.mass ?? 0;

	// "How often do they leave the seed line before it ends" only makes sense for
	// nodes ON that line. Once the tree branches there are several nodes at any
	// given ply — one per branch — so filtering by ply alone double-counts, and
	// the total sails past 100%. Match the path, not the depth.
	const seedSans = seedPath(spec.line);
	const onSeed = (d: Deviation) =>
		d.ply < seed.length &&
		d.path.length === d.ply &&
		d.path.every((san, i) => san === seedSans[i]) &&
		d.san !== seedSans[d.ply];

	const earlyDeviationMass = [...deviations, ...dropped]
		.filter(onSeed)
		.reduce((s, d) => s + d.mass, 0);

	return {
		repertoireId: spec.id,
		colour: spec.colour,
		trunk: trunk.sort((a, b) => b.mass - a.mass),
		deviations: deviations.sort((a, b) => b.mass - a.mass),
		dropped: dropped.sort((a, b) => b.mass - a.mass),
		trunkSurvivalMass: seedEndMass,
		earlyDeviationMass,
		complete,
		warnings,
		stats: { nodes: trunk.length, explorerCalls, evalCalls, maxPly },
	};
}

/** SAN moves of the seed line, for identifying nodes that sit on it. */
function seedPath(line: string): string[] {
	let fen = INITIAL_FEN;
	const sans: string[] = [];
	for (const uci of playSanLine(line).ucis) {
		const r = applyUci(fen, uci);
		sans.push(r.san);
		fen = r.fen;
	}
	return sans;
}

function safeApply(fen: string, uci: string): string | null {
	try {
		return applyUci(fen, uci).fen;
	} catch {
		return null;
	}
}

export function activeRepertoire(): { id: string; colour: Colour; line: string } {
	const r = CONFIG.repertoires.find((x) => x.active) ?? CONFIG.repertoires[0];
	return { id: r.id, colour: r.colour as Colour, line: r.line };
}

/** Render a build as pasteable plain text. */
export function formatBuildForClipboard(r: BuildResult, spec: { line: string }): string {
	const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
	const L: string[] = [];

	L.push(`# Coverage audit — ${r.repertoireId}`);
	L.push(`seed line: ${spec.line}`);
	L.push(`colour: ${r.colour === 'w' ? 'White' : 'Black'}`);
	L.push(`bands: ${CONFIG.explorer.ratings.join(',')}  speeds: ${CONFIG.explorer.speeds.join(',')}`);
	L.push(`complete: ${r.complete}`);
	L.push(
		`tree: ${r.stats.nodes} nodes to ply ${r.stats.maxPly}  ` +
			`(${r.stats.explorerCalls} explorer, ${r.stats.evalCalls} eval calls)`,
	);
	L.push(`reach end of seed line: ${pct(r.trunkSurvivalMass)}`);
	L.push(`deviate before it: ${pct(r.earlyDeviationMass)}`);
	L.push(`drill candidates: ${r.deviations.length} (+${r.dropped.length} below the frequency floor)`);
	L.push('');

	if (r.warnings.length) {
		L.push('## warnings');
		for (const w of r.warnings.slice(0, 20)) L.push(`- ${w}`);
		L.push('');
	}

	L.push('## our repertoire moves (auto-chosen past the seed)');
	L.push('ply | line | our move | why | reached');
	for (const n of r.trunk.filter((x) => x.ourMove).sort((a, b) => b.mass - a.mass).slice(0, 40)) {
		L.push([n.ply, n.path.join(' ') || '(start)', n.ourMove!.san, n.ourMove!.reason, pct(n.mass)].join(' | '));
	}
	L.push('');

	L.push('## top drill candidates by share of games');
	L.push('ply | after | move | freq | share | games | opp-score | expanded');
	for (const d of r.deviations.slice(0, 60)) {
		L.push(
			[d.ply, d.path.join(' ') || '(start)', d.san, pct(d.frequency), pct(d.mass), d.gameCount, pct(d.scoreForOpponent), d.expanded ? 'yes' : 'no'].join(' | '),
		);
	}

	return L.join('\n');
}
