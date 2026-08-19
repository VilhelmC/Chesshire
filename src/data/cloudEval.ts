// Position analysis, cloud-first.
//
// ---------------------------------------------------------------------------
// SIGN CONVENTION — verified empirically 2026-08-18, do not "tidy" this away.
//
//   Lichess cloud-eval returns cp AND mate from WHITE's point of view.
//   Local Stockfish (UCI) returns them from the SIDE TO MOVE's point of view.
//
// Evidence (all three positions have Black to move):
//   1.e4 e5 2.Nf3 f6 3.Nxe5   White up a pawn  -> cloud cp = +157
//   1.f3 e5 2.g4              Black mates in 1 -> cloud mate = -1
//   Fried Liver 6.Nxf7        White better     -> cloud cp = +88
// Under a side-to-move convention all three would carry the opposite sign.
//
// This module normalises EVERYTHING to White's point of view, and says so in
// the field name (`cpWhite`). An earlier version mixed the two conventions in
// one field and cached them under one key, which silently flipped every
// evaluation in positions where Black was to move.
// ---------------------------------------------------------------------------

import { db } from './db';
import { engine, toWhitePov } from '../engine/stockfish';
import { sideToMove } from '../domain/chess';

const ENDPOINT = 'https://lichess.org/api/cloud-eval';
const MIN_INTERVAL_MS = 300;
/** Consecutive cloud misses before we stop asking for the rest of the run. */
const MISS_LIMIT = 6;
/** Bumped when the stored convention changes, so stale rows are never read. */
const CACHE_VERSION = 'v2w';

let lastRequest = 0;
let consecutiveMisses = 0;
let cloudDisabled = false;

/**
 * What the last move actually cost.
 *
 * "Thinking takes a long time" is not something you can act on; "eleven engine
 * calls, nine of them local searches" is. Counted here rather than estimated,
 * and surfaced in schackal.dump().
 */
export const evalStats = {
	calls: 0,
	cacheHits: 0,
	cloudHits: 0,
	localRuns: 0,
	msTotal: 0,
	reset() {
		this.calls = 0;
		this.cacheHits = 0;
		this.cloudHits = 0;
		this.localRuns = 0;
		this.msTotal = 0;
	},
};
/** In-flight requests by key, so concurrent callers share one lookup. */
const inflight = new Map<string, Promise<Analysis>>();

export function resetCloudCircuit(): void {
	consecutiveMisses = 0;
	cloudDisabled = false;
}

export function cloudStatus(): { disabled: boolean; misses: number } {
	return { disabled: cloudDisabled, misses: consecutiveMisses };
}

export type Pv = {
	/** Centipawns from WHITE's point of view. Mate is mapped to ±(10000 − 10·plies). */
	cpWhite: number;
	pv: string[];
};

export type Analysis = {
	fen: string;
	depth: number;
	source: 'cloud' | 'local';
	pvs: Pv[];
};

type CloudEvalResponse = {
	fen: string;
	knodes: number;
	depth: number;
	pvs: { moves: string; cp?: number; mate?: number }[];
};

function mateToCp(mate: number): number {
	return mate > 0 ? 10000 - mate * 10 : -10000 - mate * 10;
}

/**
 * Analyse a position, preferring Lichess's free cache of deep analysis.
 *
 * Falls back to the local engine when the cloud has no entry, has one that is
 * too shallow, or has fewer principal variations than we asked for — that last
 * check matters, because the punishment generator needs genuine alternatives,
 * not just the best move.
 */
export function analysePosition(
	fen: string,
	minDepth: number,
	multiPv = 1,
	movetimeMs?: number,
): Promise<Analysis> {
	// movetime is part of the identity of a result, not an incidental detail:
	// a 300ms search and a depth-24 search are different answers.
	const key = `${CACHE_VERSION}|${fen}|${minDepth}|${multiPv}|${movetimeMs ?? 0}`;

	const existing = inflight.get(key);
	if (existing) return existing;

	const run = async (): Promise<Analysis> => {
		const started = performance.now();
		evalStats.calls++;
		const hit = await db.evalCache.get(key);
		if (hit) {
			evalStats.cacheHits++;
			evalStats.msTotal += performance.now() - started;
			return { fen, depth: hit.depth ?? minDepth, source: hit.source, pvs: hit.pvs as Pv[] };
		}

		// Only consult the cloud for single-PV queries. Lichess stores one
		// principal variation for the overwhelming majority of positions, so a
		// multi-PV request all but guarantees a rejected response followed by a
		// local run — the round trip is pure added latency.
		const canUseCloud = multiPv === 1 && !cloudDisabled;
		const cloud = canUseCloud ? await tryCloud(fen, minDepth) : null;

		if (canUseCloud) {
			if (cloud) consecutiveMisses = 0;
			else if (++consecutiveMisses >= MISS_LIMIT) cloudDisabled = true;
		}

		const result = cloud ?? (await runLocal(fen, minDepth, multiPv, movetimeMs));
		if (cloud) evalStats.cloudHits++;
		else evalStats.localRuns++;
		evalStats.msTotal += performance.now() - started;

		await db.evalCache.put({
			key,
			fetchedAt: Date.now(),
			source: result.source,
			depth: result.depth,
			cp: result.pvs[0]?.cpWhite ?? 0,
			pvs: result.pvs,
		});
		return result;
	};

	const p = run().finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

async function tryCloud(fen: string, minDepth: number): Promise<Analysis | null> {
	try {
		const wait = Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now());
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastRequest = Date.now();

		const url = new URL(ENDPOINT);
		url.searchParams.set('fen', fen);
		url.searchParams.set('multiPv', '1');

		const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
		// 404 just means "not in the cache" — the ordinary case, not an error.
		if (!res.ok) return null;

		const data = (await res.json()) as CloudEvalResponse;
		if (data.depth < minDepth) return null;
		if (!data.pvs?.length) return null;

		// Already White's point of view — no conversion.
		const pvs: Pv[] = data.pvs.map((p) => ({
			cpWhite: p.mate !== undefined ? mateToCp(p.mate) : (p.cp ?? 0),
			pv: p.moves.split(' '),
		}));

		return { fen, depth: data.depth, source: 'cloud', pvs };
	} catch {
		return null;
	}
}

async function runLocal(
	fen: string,
	depth: number,
	multiPv: number,
	movetimeMs?: number,
): Promise<Analysis> {
	const r = await engine.analyse(fen, depth, multiPv, movetimeMs);
	const stm = sideToMove(fen);
	// UCI is side-to-move relative — convert.
	const pvs: Pv[] = r.lines.map((l) => ({ cpWhite: toWhitePov(l.cp, stm), pv: l.pv }));
	return { fen, depth, source: 'local', pvs };
}

/** White's point of view -> `colour`'s point of view. */
export function toColourPov(cpWhite: number, colour: 'w' | 'b'): number {
	return colour === 'w' ? cpWhite : -cpWhite;
}
