// Punishment line generation and validation — SPEC.md §4 step 5.
//
// The naive version of this takes Stockfish's principal variation and calls it
// the refutation. That produces drills which are wrong the moment the opponent
// deviates a SECOND time — which, at 1200, they will. So instead we build a
// branching tree: at every opponent node we enumerate every reply that isn't
// clearly losing, and require the drill to hold up against all of them.
//
// Cloud-first: Lichess's cloud-eval carries depth 40-55 analysis for most
// opening positions, which is both faster and deeper than anything we can run
// locally. Its sign convention (White's point of view, unlike UCI's
// side-to-move) was verified empirically before use — see data/cloudEval.ts.
// Anything the cloud does not hold, or holds too shallowly, falls back to the
// local engine.

import { analysePosition, toColourPov } from '../data/cloudEval';
import { detectMotifs } from './motifs';
import { applyUci } from '../domain/chess';
import {
	UNIQUE_MARGIN,
	RESIST_MARGIN,
	WIN_THRESHOLD,
	MAX_PLIES,
	MAX_NODES,
	MAX_REPLIES,
	TREE_MOVETIME_MS,
	D_SHALLOW,
	D_DEEP,
	D_VERIFY,
	D_VERIFY_CLOUD,
	VERIFY_MOVETIME_MS,
	classifyMove,
} from '../domain/classify';
import type { Motif, MoveClass, SolutionTree } from '../domain/types';
import type { Deviation } from '../domain/repertoire';

export type PunishmentResult = {
	deviationId: string;
	/** Position the drill starts from — after the opponent's deviation. */
	rootFen: string;
	/** Our colour in this drill. */
	ourColour: 'w' | 'b';
	evalBefore: number; // cp, our POV, before the deviation
	evalAfter: number; // cp, our POV, after it
	delta: number;
	classification: MoveClass;
	/** null when the position is not drillable as a fixed refutation. */
	solution: SolutionTree | null;
	/** Why it was downgraded, if it was. */
	downgradeReason: string | null;
	nodeCount: number;
	/** How many analyses came from the Lichess cloud rather than local Stockfish. */
	cloudHits: number;
	/**
	 * Independent re-check at greater depth. null = not run.
	 * The drill is only trustworthy when this is true.
	 */
	verified: boolean | null;
	verifyNote: string | null;
	motifs: Motif[];
	/** Engine's assessment at the end of the main line, our POV. */
	finalEval: number | null;
	/** How much the opponent is currently getting away with — see SPEC.md §2. */
	punishmentGap: number | null;
	engineCalls: number;
};

export type PunishOptions = {
	deep?: number;
	shallow?: number;
	maxPlies?: number;
	maxNodes?: number;
	movetimeMs?: number;
	onProgress?: (msg: string) => void;
	/** Polled between nodes so a long run can be abandoned from the UI. */
	shouldCancel?: () => boolean;
};

export class CancelledError extends Error {
	constructor() {
		super('cancelled');
	}
}

// Evaluations arrive from analysePosition already normalised to White's point
// of view, so converting to "our" point of view no longer depends on whose turn
// it is. That dependency was the source of the sign bug this replaced.

export type Classification = {
	evalBefore: number;
	evalAfter: number;
	delta: number;
	classification: MoveClass;
	cloudHits: number;
};

/**
 * Cheap first pass: two evaluations, no tree.
 *
 * Exists so the candidate set can be the WHOLE deviation list rather than the
 * most frequent slice of it. The first live run analysed the twelve most
 * popular deviations and found zero blunders, which is exactly what should
 * happen — moves are popular because they are sound. Punishable moves live in
 * the tail, so the tail has to be swept before anything is ranked.
 */
export async function classifyDeviation(
	dev: Deviation,
	ourColour: 'w' | 'b',
): Promise<Classification> {
	let cloudHits = 0;
	const before = await analysePosition(dev.fromFen, D_SHALLOW, 1);
	const after = await analysePosition(dev.fen, D_SHALLOW, 1);
	if (before.source === 'cloud') cloudHits++;
	if (after.source === 'cloud') cloudHits++;

	const evalBefore = toColourPov(before.pvs[0]?.cpWhite ?? 0, ourColour);
	const evalAfter = toColourPov(after.pvs[0]?.cpWhite ?? 0, ourColour);

	return {
		evalBefore,
		evalAfter,
		delta: evalAfter - evalBefore,
		classification: classifyMove(evalBefore, evalAfter),
		cloudHits,
	};
}

/**
 * Analyse one opponent deviation and, if it is bad enough, build a validated
 * branching refutation.
 */
export async function generatePunishment(
	dev: Deviation,
	ourColour: 'w' | 'b',
	opts: PunishOptions = {},
): Promise<PunishmentResult> {
	const deep = opts.deep ?? D_DEEP;
	const shallow = opts.shallow ?? D_SHALLOW;
	const maxPlies = opts.maxPlies ?? MAX_PLIES;
	const maxNodes = opts.maxNodes ?? MAX_NODES;
	const movetime = opts.movetimeMs ?? TREE_MOVETIME_MS;

	let engineCalls = 0;
	let cloudHits = 0;
	/**
	 * multiPv === 1 goes to the cloud (deep, instant, cached by Lichess).
	 * multiPv > 1 has to run locally, so it gets a time budget instead of a
	 * depth target — otherwise a single drill can take minutes.
	 */
	const analyse = async (fen: string, depth: number, multiPv: number) => {
		engineCalls++;
		const a = await analysePosition(
			fen,
			depth,
			multiPv,
			multiPv > 1 ? movetime : undefined,
		);
		if (a.source === 'cloud') cloudHits++;
		return a;
	};

	opts.onProgress?.(`classifying ${dev.san}`);

	// Evaluate before and after the deviation, both from our point of view.
	const beforeRaw = await analyse(dev.fromFen, shallow, 1);
	const afterRaw = await analyse(dev.fen, shallow, 1);
	const evalBefore = toColourPov(beforeRaw.pvs[0]?.cpWhite ?? 0, ourColour);
	const evalAfter = toColourPov(afterRaw.pvs[0]?.cpWhite ?? 0, ourColour);
	const delta = evalAfter - evalBefore;
	const classification = classifyMove(evalBefore, evalAfter);

	const base: PunishmentResult = {
		deviationId: dev.id,
		rootFen: dev.fen,
		ourColour,
		evalBefore,
		evalAfter,
		delta,
		classification,
		solution: null,
		downgradeReason: null,
		nodeCount: 0,
		cloudHits: 0,
		verified: null,
		verifyNote: null,
		motifs: [],
		finalEval: null,
		punishmentGap: null,
		engineCalls,
	};

	if (classification !== 'blunder') {
		base.downgradeReason =
			classification === 'refutes_us'
				? 'This move is good for them — our repertoire has a hole here, not a drill.'
				: `${delta > 0 ? '+' : ''}${delta}cp to ${evalAfter}cp — not enough to punish concretely.`;
		base.engineCalls = engineCalls;
		base.cloudHits = cloudHits;
		return base;
	}

	opts.onProgress?.(`building refutation for ${dev.san}`);

	let nodeCount = 0;
	let overflow = false;

	const build = async (fen: string, pliesLeft: number): Promise<SolutionTree | null> => {
		if (pliesLeft <= 0 || overflow) return null;
		if (opts.shouldCancel?.()) throw new CancelledError();
		if (++nodeCount > maxNodes) {
			overflow = true;
			return null;
		}
		opts.onProgress?.(`${dev.san}: node ${nodeCount}, ${engineCalls} analyses`);

		// Our move: take the best, plus anything within UNIQUE_MARGIN of it.
		const ours = await analyse(fen, deep, 3);
		if (!ours.pvs.length) return null;
		// Rank from OUR point of view, so "best" means best for us regardless of
		// colour. Sorting White-POV numbers directly would pick Black's best move
		// when we are Black.
		const ranked = ours.pvs
			.map((p) => ({ ...p, ourCp: toColourPov(p.cpWhite, ourColour) }))
			.filter((p) => p.pv.length)
			.sort((a, b) => b.ourCp - a.ourCp);
		if (!ranked.length) return null;
		const bestCp = ranked[0].ourCp;

		const ourMoves = ranked
			.filter((p) => bestCp - p.ourCp <= UNIQUE_MARGIN)
			.map((p) => ({
				uci: p.pv[0],
				san: safeSan(fen, p.pv[0]),
				cpLoss: bestCp - p.ourCp,
			}));
		if (!ourMoves.length) return null;

		// Winning clearly enough? Stop — the drill has achieved its goal.
		const afterOurMove = applyUciSafe(fen, ourMoves[0].uci);
		if (!afterOurMove) return { ourMoves, replies: {} };
		if (bestCp >= WIN_THRESHOLD) return { ourMoves, replies: {} };

		// Their reply: every move not clearly losing is one a human might find.
		// Ranked from THEIR point of view for the same reason as above.
		const theirColour: 'w' | 'b' = ourColour === 'w' ? 'b' : 'w';
		const theirs = await analyse(afterOurMove, deep, 4);
		const theirRanked = theirs.pvs
			.map((p) => ({ ...p, theirCp: toColourPov(p.cpWhite, theirColour) }))
			.filter((p) => p.pv.length)
			.sort((a, b) => b.theirCp - a.theirCp);
		const theirBest = theirRanked[0]?.theirCp ?? 0;
		const plausible = theirRanked
			.filter((p) => theirBest - p.theirCp <= RESIST_MARGIN)
			.slice(0, MAX_REPLIES);

		const replies: Record<string, SolutionTree | null> = {};
		for (const reply of plausible) {
			const next = applyUciSafe(afterOurMove, reply.pv[0]);
			replies[reply.pv[0]] = next ? await build(next, pliesLeft - 2) : null;
			if (overflow) break;
		}

		return { ourMoves, replies };
	};

	const solution = await build(dev.fen, maxPlies);

	if (overflow) {
		base.solution = null;
		base.downgradeReason =
			`Refutation branches past ${maxNodes} nodes — too wide to memorise as a line. ` +
			`Better trained as a "play it out" pressure drill.`;
		base.nodeCount = nodeCount;
		base.engineCalls = engineCalls;
		base.cloudHits = cloudHits;
		return base;
	}

	const firstMove = solution?.ourMoves[0];
	const finalLine = firstMove ? await analyse(dev.fen, deep, 1) : null;
	const finalEval = finalLine ? toColourPov(finalLine.pvs[0]?.cpWhite ?? 0, ourColour) : null;

	// ---- soundness verification -------------------------------------------
	// The generator picked its move at depth `deep`. Re-run the root deeper and
	// independently: if the recommended move stops being best, the drill would
	// have taught a refutation that does not refute. This is the check that
	// makes the M2 gate machine-decidable instead of a matter of opinion.
	let verified: boolean | null = null;
	let verifyNote: string | null = null;

	if (firstMove) {
		// ------------------------------------------------------------------
		// Verification.
		//
		// Preferred path: Lichess's cloud analysis. It is depth 40-55, instant,
		// and genuinely independent of our search — a far stronger check than
		// anything we can compute locally. It only stores one principal
		// variation, but that is enough for the decisive question: does the
		// deepest available analysis agree that our move is THE move?
		//
		// It cannot measure the margin to the second-best move, so when the
		// cloud disagrees (or has nothing) we fall back to a local MultiPV
		// search with a time budget. Depth 24 with MultiPV 3 was tried first and
		// blew past the engine timeout on the single-threaded build.
		// ------------------------------------------------------------------
		opts.onProgress?.(`${dev.san}: verifying`);
		engineCalls++;
		const cloudCheck = await analysePosition(dev.fen, D_VERIFY_CLOUD, 1);

		if (cloudCheck.source === 'cloud' && cloudCheck.pvs[0]?.pv.length) {
			cloudHits++;
			const bestUci = cloudCheck.pvs[0].pv[0];
			const cloudCp = toColourPov(cloudCheck.pvs[0].cpWhite, ourColour);

			if (bestUci === firstMove.uci) {
				verified = cloudCp >= 100;
				verifyNote = verified
					? `Confirmed at depth ${cloudCheck.depth}: ${firstMove.san} is the top move (${cloudCp}cp).`
					: `Deep analysis agrees ${firstMove.san} is best but values it at only ${cloudCp}cp — not a punishment.`;
			} else {
				const alt = safeSan(dev.fen, bestUci);
				verified = false;
				verifyNote = `At depth ${cloudCheck.depth} the top move is ${alt}, not ${firstMove.san}.`;
			}
		} else {
			engineCalls++;
			const check = await analysePosition(dev.fen, D_VERIFY, 3, VERIFY_MOVETIME_MS);
			const ranked = check.pvs
				.map((p) => ({ uci: p.pv[0], ourCp: toColourPov(p.cpWhite, ourColour) }))
				.filter((p) => p.uci)
				.sort((a, b) => b.ourCp - a.ourCp);

			const deepBest = ranked[0];
			const ourAtDepth = ranked.find((p) => p.uci === firstMove.uci);

			if (!deepBest) {
				verified = null;
				verifyNote = 'Verification returned no lines.';
			} else if (!ourAtDepth) {
				verified = false;
				verifyNote = `Deeper local search does not rank ${firstMove.san} (best: ${safeSan(dev.fen, deepBest.uci)}).`;
			} else if (deepBest.ourCp - ourAtDepth.ourCp > UNIQUE_MARGIN) {
				verified = false;
				verifyNote = `${firstMove.san} is ${deepBest.ourCp - ourAtDepth.ourCp}cp worse than ${safeSan(dev.fen, deepBest.uci)} on a longer search.`;
			} else if (ourAtDepth.ourCp < 100) {
				verified = false;
				verifyNote = `Longer search values the refutation at only ${ourAtDepth.ourCp}cp — not a punishment.`;
			} else {
				verified = true;
				verifyNote = `Holds on a ${VERIFY_MOVETIME_MS}ms local search (${ourAtDepth.ourCp}cp).`;
			}
		}
	}

	return {
		...base,
		solution,
		nodeCount,
		motifs: firstMove ? detectMotifs(dev.fen, firstMove.uci) : [],
		finalEval,
		punishmentGap: computePunishmentGap(finalEval, dev.scoreForOpponent),
		engineCalls,
		cloudHits,
		verified,
		verifyNote,
	};
}

/**
 * How much the opponent is currently getting away with.
 *
 * If the refutation leaves us at +N centipawns, a correctly-punished opponent
 * should score roughly `expectedScore(-N)`. They actually score
 * `scoreForOpponent`. The difference is the value of learning this drill — and
 * it is a far better priority signal than raw frequency. A common but sound
 * move has a gap near zero; a rare, near-losing move that still scores 52% has
 * a huge one. See SPEC.md §2, "the punishment gap".
 */
export function computePunishmentGap(
	finalEvalOurPov: number | null,
	scoreForOpponent: number,
): number | null {
	if (finalEvalOurPov === null) return null;
	const theirExpected = expectedScore(-finalEvalOurPov);
	return scoreForOpponent - theirExpected;
}

/** Standard logistic mapping from centipawns to expected score, 0..1. */
export function expectedScore(cp: number): number {
	return 1 / (1 + Math.pow(10, -cp / 400));
}

function applyUciSafe(fen: string, uci: string): string | null {
	try {
		return applyUci(fen, uci).fen;
	} catch {
		return null;
	}
}

function safeSan(fen: string, uci: string): string {
	try {
		return applyUci(fen, uci).san;
	} catch {
		return uci;
	}
}

/** Flatten a solution tree into readable lines, for review and captions. */
export function describeSolution(fen: string, tree: SolutionTree | null, depth = 0): string[] {
	if (!tree || depth > 6) return [];
	const out: string[] = [];
	const our = tree.ourMoves[0];
	if (!our) return out;

	const alt = tree.ourMoves.length > 1 ? ` (or ${tree.ourMoves.slice(1).map((m) => m.san).join(', ')})` : '';
	const afterOurs = applyUciSafe(fen, our.uci);
	const replyKeys = Object.keys(tree.replies);

	if (!replyKeys.length || !afterOurs) {
		out.push(`${our.san}${alt}`);
		return out;
	}

	for (const uci of replyKeys) {
		const san = safeSan(afterOurs, uci);
		const next = applyUciSafe(afterOurs, uci);
		const sub = next ? describeSolution(next, tree.replies[uci], depth + 1) : [];
		if (!sub.length) out.push(`${our.san}${alt} ${san}`);
		else for (const s of sub) out.push(`${our.san}${alt} ${san} ${s}`);
	}

	return out;
}

/** Render a batch of results as pasteable text, for offline review. */
export function formatDrillsForClipboard(
	rows: { dev: Deviation; result: PunishmentResult }[],
): string {
	const L: string[] = [];
	const cp = (n: number | null) => (n === null ? '-' : `${n > 0 ? '+' : ''}${(n / 100).toFixed(2)}`);

	const drillable = rows.filter((r) => r.result.solution);
	const verified = drillable.filter((r) => r.result.verified === true);

	L.push('# Punishment generator — M2 audit');
	L.push(`analysed: ${rows.length}`);
	L.push(`drillable: ${drillable.length}`);
	L.push(`verified at deeper search: ${verified.length}`);
	L.push('');

	for (const { dev, result } of rows) {
		L.push(`## ${dev.path.join(' ') || '(start)'} ${dev.san}`);
		L.push(`fen: ${result.rootFen}`);
		L.push(
			`share-of-games: ${(dev.mass * 100).toFixed(2)}%  freq-at-node: ${(dev.frequency * 100).toFixed(1)}%  ` +
				`games: ${dev.gameCount}  they-score: ${(dev.scoreForOpponent * 100).toFixed(1)}%`,
		);
		L.push(
			`eval: ${cp(result.evalBefore)} -> ${cp(result.evalAfter)}  delta: ${result.delta}cp  class: ${result.classification}`,
		);
		L.push(
			`verified: ${result.verified === null ? 'n/a' : result.verified}  ${result.verifyNote ?? ''}`,
		);
		if (result.punishmentGap !== null) {
			L.push(
				`final: ${cp(result.finalEval)}  punishment-gap: ${(result.punishmentGap * 100).toFixed(1)}pp  ` +
					`priority(gap*mass): ${(result.punishmentGap * dev.mass * 100).toFixed(3)}`,
			);
		}
		if (result.motifs.length) L.push(`motifs: ${result.motifs.join(', ')}`);
		L.push(
			`nodes: ${result.nodeCount}  analyses: ${result.engineCalls} (${result.cloudHits} cloud)`,
		);
		if (result.downgradeReason) L.push(`downgraded: ${result.downgradeReason}`);
		if (result.solution) {
			L.push('lines:');
			for (const line of describeSolution(result.rootFen, result.solution)) L.push(`  ${line}`);
		}
		L.push('');
	}

	return L.join('\n');
}
