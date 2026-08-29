// The vocabulary: named things a learner can see on the board.
//
// ---------------------------------------------------------------------------
// `PLAN-EXPLAINER.md` §0 — Stockfish is the ORACLE and this is the VOCABULARY.
// The engine says what is good and by how much, which it is better at than
// anything we will write. These say what KIND of thing is going on, in objects
// that can be drawn.
//
// Two rules, both learned the hard way in the solver arc:
//
//   1. EVERY PRIMITIVE IS PURE. A position in, marks out. No engine, no search,
//      no cache. That is what makes each one gateable on its own.
//   2. EVERY PRIMITIVE SHIPS WITH ITS OWN NUMBERS. §4's gate is per-overlay and
//      not in aggregate: an overlay that fires on 40% of quiet positions is a
//      decoration, not a detector. This is the discipline that stops the
//      hundred-hand-written-features death that explainer projects die of.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Color, NormalMove, Role, Square } from 'chessops/types';
import { attacks } from 'chessops/attacks';
import { makeSquare } from 'chessops/util';
import { V, other, seeValue } from '../exchange';
import { quiesce, materialFor } from '../ladder';

/** One thing worth drawing: some squares, maybe an arrow, and a line of words. */
export type Mark = {
	/** The move that produces it, when there is one. */
	move?: NormalMove;
	/** Squares to ring — the men involved. */
	squares: Square[];
	/** What it is, in a few words. Fixed text, never generated. */
	note: string;
};

const after = (pos: Chess, m: NormalMove): Chess => {
	const n = pos.clone();
	n.play(m);
	return n;
};

/** Every legal move, promotions written out. */
export function moves(pos: Chess): NormalMove[] {
	const out: NormalMove[] = [];
	const promo: Role[] = ['queen', 'rook', 'bishop', 'knight'];
	for (const [from, dests] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const last = piece.color === 'white' ? 7 : 0;
		for (const to of dests) {
			if (piece.role === 'pawn' && to >> 3 === last) for (const p of promo) out.push({ from, to, promotion: p });
			else out.push({ from, to });
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// SAFE
//
// "Which of my moves do not simply drop material?" — the first thing a beginner
// cannot see, and the overlay with the least to prove: it is SEE, which the
// exchange module has carried for the whole project and which the opt-out bound
// (`AMEND-RUNG-ORDER.md`) showed is exact for a single square.
//
// It has no Lichess theme to be scored against, so its gate is a REFEREE rather
// than a label: play the move, and check the material really does hold once every
// capture has been played out. `scripts/m4-gate.mjs` does that with the
// quiescence from the ladder work.
//
// ---------------------------------------------------------------------------
// AND THE REFEREE BECAME THE IMPLEMENTATION. MEASURED, `scripts/m4-gate.mjs`.
//
// The first version was SEE alone: after the move, is any of our men takeable at
// a profit. Refereed against quiescence over 15,008 legal moves, 4.36% of the
// moves it called safe lost a pawn or more once the captures played out. The
// worst of them were not the case this code expected — `settled`'s known "two
// hanging men, only one of which can be saved" — but a different one entirely:
//
//     1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b — the rook leaves the eighth rank
//     8/8/7K/5kP1/7R/8/7p/1r6 w         — the rook leaves the h-file
//
// In both, the man that moves WAS the defender of a promotion square. After the
// move nothing is attacked at a profit, so a static per-square exchange sees a
// quiet position; the loss arrives a ply later, when the pawn queens. A third
// shape appeared too — the defender pulled away mid-exchange (`ZObPi`, where Qg3
// invites Qxg3+ Kxg3 and the king that was holding f1 is no longer on g2).
//
// None of those is a tuning failure. They are the difference between a test and
// a search, and nothing done inside a static test closes it.
//
// So the verdict comes from the search, which `scripts/m4-safe-cost.mjs` says is
// affordable: classifying EVERY legal move in a position costs 3.1ms on average
// and 46ms at the worst, against 1.4ms for the static test. 2.3x for a number
// that cannot be wrong, on an overlay drawn once per position. That is not a
// trade worth taking the other way — an overlay whose whole promise is "this
// does not drop material" and which is wrong one time in twenty-three is worse
// than no overlay, because the reader has no way to know which time.
//
// SEE IS KEPT, for the one thing the search cannot do: name a square. A number
// is not something to draw a ring around.
// ---------------------------------------------------------------------------

/**
 * What this move hangs, if anything: the man it leaves takeable at a profit.
 *
 * Negative means material is lost. The square named is the one that falls, which
 * is what a ring on the board should be around — not the square moved to, which
 * is where the eye already is.
 */
export function hangs(pos: Chess, move: NormalMove): { square: Square; loss: number } | null {
	const child = after(pos, move);
	const us = pos.turn;
	const them = other(us);
	let worst: { square: Square; loss: number } | null = null;
	// Only our men that they actually bear on can fall. Building their attack set
	// once turns this from "SEE every man we own" into a handful.
	let reach = 0n as unknown as ReturnType<typeof attacks>;
	let first = true;
	for (const from of child.board[them]) {
		const p = child.board.get(from);
		if (!p) continue;
		const a = attacks(p, from, child.board.occupied);
		reach = first ? a : reach.union(a);
		first = false;
	}
	if (first) return null;
	for (const square of child.board[us].intersect(reach)) {
		const v = seeValue(child.board, square, them);
		if (v > 0 && (!worst || v > worst.loss)) worst = { square, loss: v };
	}
	return worst;
}

/**
 * What the move really costs, once every capture on the board has played out.
 *
 * Zero when material holds. This is the verdict — `hangs` only supplies the ring.
 * Mate is not a material question and is never unsafe.
 */
export function costs(pos: Chess, move: NormalMove): number {
	const us = pos.turn;
	const child = after(pos, move);
	if (child.isCheckmate()) return 0;
	const drop = materialFor(child.board, us) - quiesce(child, us);
	return drop > 0 ? drop : 0;
}

/**
 * The move drops material, and — where SEE can say so — the man that falls.
 *
 * `square` is null for the cases only the search sees: a promotion the mover was
 * holding back, or a defender deflected mid-exchange. The overlay then has a
 * warning without a ring, which is honest. Inventing a square to point at would
 * not be.
 */
export function unsafe(pos: Chess, move: NormalMove): { loss: number; square: Square | null } | null {
	const loss = costs(pos, move);
	if (loss <= 0) return null;
	const named = hangs(pos, move);
	return { loss, square: named ? named.square : null };
}

/** Moves that drop nothing. The overlay draws these; the rest are the lesson. */
export function safeMoves(pos: Chess): NormalMove[] {
	return moves(pos).filter((m) => costs(pos, m) === 0);
}

// ---------------------------------------------------------------------------
// MATE
//
// The ladder's king rung, which is finished work: 0% missed on `mateIn1`,
// `mateIn2` and `mateIn3` across 2,656 solver plies once the horizon went to 5
// (`FINDING-THE-MATE-HORIZON.md`). Here it only needs its shallowest form, which
// needs no search at all.
// ---------------------------------------------------------------------------

/** Moves that mate outright. */
export function mates(pos: Chess): NormalMove[] {
	return moves(pos).filter((m) => after(pos, m).isCheckmate());
}

// ---------------------------------------------------------------------------
// FORK
//
// One man attacking two the opponent cannot both save.
//
// THE DEFINITION IS THE WHOLE PROBLEM, and getting it loose is how a detector
// becomes a decoration. "Attacks two pieces" fires on nearly every position: a
// queen on an open board attacks half of it. Three conditions narrow it to the
// thing a learner is being taught to see:
//
//   1. TWO OR MORE TARGETS WORTH TAKING. Each must be worth more than the forking
//      man, or defended-but-profitable by SEE. A rook "forking" two pawns it
//      cannot win is not a fork.
//   2. THE FORKING MAN MUST SURVIVE. If it can simply be taken, nothing is
//      forked — the most common false positive by far.
//   3. THEY CANNOT BOTH BE SAVED. A check is the classic case, because the reply
//      is forced and the other target falls. Without a check the opponent gets a
//      free move, so this requires that no single reply saves both.
//
// Condition 3 is the expensive one and the one that makes this a detector rather
// than a filter. It is one ply of their replies — the same shape as the ladder's
// `guarantees`, and for the same reason.
// ---------------------------------------------------------------------------

export type Fork = { move: NormalMove; targets: Square[]; gain: number };

/**
 * Forks available to the side to move.
 *
 * `minGain` is the material the fork must actually promise. A "fork" that wins
 * nothing is a coincidence of geometry.
 */
export function forks(pos: Chess, minGain = V.knight): Fork[] {
	const us = pos.turn;
	const them = other(us);
	const out: Fork[] = [];

	for (const move of moves(pos)) {
		const child = after(pos, move);
		const piece = child.board.get(move.to);
		if (!piece) continue;

		// (2) The forking man must survive. If they can take it at a profit, the
		// geometry is irrelevant — and this is the single largest source of false
		// forks, so it is checked before anything expensive.
		if (seeValue(child.board, move.to, them) > 0) continue;

		// (1) What it now attacks that is worth taking.
		const hit = attacks(piece, move.to, child.board.occupied).intersect(child.board[them]);
		const targets: Square[] = [];
		let best = 0;
		for (const square of hit) {
			const victim = child.board.get(square);
			if (!victim) continue;
			// A king cannot be captured, but attacking one IS the forcing half of a
			// fork — it is counted as a target and contributes no material.
			if (victim.role === 'king') {
				targets.push(square);
				continue;
			}
			const gain = seeValue(child.board, square, us);
			if (gain <= 0) continue;
			targets.push(square);
			if (gain > best) best = gain;
		}
		if (targets.length < 2 || best < minGain) continue;

		// (3) Can any single reply save them all? One ply of their choice.
		if (savesAll(child, us, best)) continue;

		out.push({ move, targets, gain: best });
	}
	return out;
}

/**
 * Is there a reply that leaves nothing worth `best` to take?
 *
 * The honest half of the definition. Without it, "attacks two men" is the whole
 * test and the overlay fires on a queen standing in the open.
 */
function savesAll(child: Chess, us: Color, best: number): boolean {
	for (const reply of moves(child)) {
		const next = after(child, reply);
		let still = 0;
		for (const square of next.board[other(us)]) {
			const v = seeValue(next.board, square, us);
			if (v > still) still = v;
		}
		if (still < best) return true; // this reply saved the day
	}
	return false;
}

// ---------------------------------------------------------------------------

/** Turn a fork into something drawable. */
export function forkMarks(f: Fork): Mark {
	return {
		move: f.move,
		squares: [f.move.to, ...f.targets],
		note: `${makeSquare(f.move.to)} forks ${f.targets.map(makeSquare).join(' and ')}`,
	};
}
