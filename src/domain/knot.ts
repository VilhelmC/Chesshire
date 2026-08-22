// The knot at a square: one fold per tempo, and the enumerated ways it fails.
//
// ---------------------------------------------------------------------------
// This replaces `race.ts`, which was wrong in a way that only a generator could
// have found. The old verdict came from an alternating search over the whole
// board, so it reported the best material White could win ANYWHERE and printed
// it as the answer about the target square. On a random position with a rook
// hanging on e3 it said "take it now: 500 at c5" — where White had no attacker
// on c5 at all. Every hand-built fixture that came out misconstructed was
// misconstructed by exactly that: I inverted a function that answers a
// different question from the one the table asks.
//
// The structure here is Will's, from SEE.md §4:
//
//   participants(k) = pieces bearing on the square now
//                   + pieces that can bear on it within k moves, both sides
//
// with the same backward induction over the larger list. Tempo enters as the
// index k, symmetrically. And the constant-tempo assumption is inherited rather
// than searched away, so a knot that fails to form fails for exactly three
// reasons, each of which is a LIST rather than a number:
//
//   1. the prize leaves;
//   2. a defender arrives in time;
//   3. someone interposes a forcing move — a check, or a threat bigger than
//      the knot — and spends the tempo the plan was counting on.
//
// Listing them is the point. A single number from a search cannot tell a human
// which of the three to look for, and those three are exactly what a human
// should look for.
//
// Scope, stated rather than hidden: k = 0 and k = 1 make claims and are
// verified two ply deep. k >= 2 is a COUNT of who could be there, not a claim
// about what happens, because two build-up moves give the defender two replies
// and this does not model that.
// ---------------------------------------------------------------------------

import type { Square, Color, Role } from 'chessops/types';
import type { Chess } from 'chessops/chess';
import { makeSquare, parseSquare } from './chess';
import { foldAt, arrivals, captureOn, VALUE, type Unit, type Fold } from './contest';
import { bestCapture } from './reply';

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** Figurine, so a move reads as a move and not as four characters. */
export const GLYPH: Record<Role, string> = {
	pawn: '♙',
	knight: '♘',
	bishop: '♗',
	rook: '♖',
	queen: '♕',
	king: '♔',
};
const DARK: Record<Role, string> = {
	pawn: '♟',
	knight: '♞',
	bishop: '♝',
	rook: '♜',
	queen: '♛',
	king: '♚',
};

/** `♘f3–g5`, or `♘f3×g5` for a capture. Never bare coordinates. */
export function moveText(role: Role, colour: Color, from: string, to: string, takes: boolean): string {
	return `${(colour === 'white' ? GLYPH : DARK)[role]}${from}${takes ? '×' : '–'}${to}`;
}

export type SpoilerKind = 'escape' | 'defender' | 'forcing' | 'quiet' | 'illegal';

export type Spoiler = {
	kind: SpoilerKind;
	/** The defender's move, in figurine notation. */
	move: string;
	/** From and to, for drawing it on a board. */
	squares: [string, string];
	/** What the attacker is left with at the target after it, in centipawns. */
	leaves: number;
	/** One sentence, generated from the numbers above. */
	why: string;
	/**
	 * How the attacker still collects after this move, when they do.
	 *
	 * This is what turns "no answer changes it" into a reason. A knight that
	 * steps off a pin has not escaped — the sentence a learner needs is which
	 * piece takes what behind it, and that is a move this already computed.
	 */
	answer?: {
		text: string;
		squares: [string, string];
		/**
		 * Where the answer happens, which is what makes the sentence mean
		 * anything: 'target' — it is taken where it stood; 'chase' — it ran and
		 * is taken where it landed; 'elsewhere' — it got away and something it
		 * was shielding did not.
		 */
		at: 'target' | 'chase' | 'elsewhere';
	};
};

export type Rung = {
	k: number;
	/** Who could be in the exchange at this k, both sides. */
	participants: { attackers: Unit[]; defenders: Unit[] };
	/** The fold over that list. */
	fold: Fold;
	/** Centipawns paid to get the late arrivals there. */
	spent: number;
	/** The count: fold minus build-up cost. What the table says. */
	count: number;
	/** The attacker's build-up move at this k, if there is one. */
	move: { role: Role; from: string; to: string; text: string } | null;
	/** What survives the defender's best answer. Null at k >= 2 — not a claim. */
	survives: number | null;
	/** Every defensive move that breaks it, and which of the three it is. */
	spoilers: Spoiler[];
	/**
	 * Their best answer, whether or not it breaks anything.
	 *
	 * A rung that holds still has to say what they tried and why it failed;
	 * "they have no answer" is an assertion, and "♞d5–c3 runs into ♖d1×d8" is a
	 * thing a reader can check on the board in front of them.
	 */
	bestTry: Spoiler | null;
	/**
	 * Their best attempt to walk the prize out of it, whether or not it works.
	 *
	 * Kept separately because "it cannot run, and here is what happens if it
	 * tries" is the sentence a learner actually needs, and it is not the same
	 * move as their objectively best reply — which is often a shrug.
	 */
	escapeTry: Spoiler | null;
	/** True when the count pays AND nothing on the spoiler list takes it away. */
	holds: boolean;
};

export type Knot = {
	target: string;
	attacker: Color;
	prize: { role: Role; colour: Color; value: number } | null;
	rungs: Rung[];
	/** The smallest k that holds, or null. */
	at: number | null;
	/** Centipawns won at that k. */
	value: number;
};

/**
 * What the attacker is left with at this square, from this position, if it is
 * their move: the resolved capture minus whatever the other side then wins
 * elsewhere.
 *
 * The subtraction is the compulsion term. Winning a knight here and losing a
 * rook there is not winning a knight, and leaving that out is how a count
 * becomes an assertion.
 */
function takeAt(pos: Chess, target: Square, attacker: Color): number {
	if (pos.turn !== attacker) return 0;
	const cap = captureOn(pos, target);
	if (!cap || cap.gain <= 0) return 0;

	const from = parseSquare(cap.from);
	if (from === undefined) return 0;
	const after = pos.clone();
	try {
		after.play({ from, to: target });
	} catch {
		return 0;
	}
	// Excluding the square we just captured on: `cap.gain` already priced the
	// recapture there, and counting it again as a "counter-threat" subtracts the
	// same rook twice — which turns a won piece into nothing at all.
	const counter = bestCapture(after, cap.to)?.gain ?? 0;

	// And only what the capture CREATED. A bishop that was already hanging on
	// the other side of the board is not the price of this exchange; it is going
	// to be lost whether we take here or not, so charging it makes taking a free
	// piece read as breaking even. Measured against doing nothing, which is the
	// only baseline that means anything.
	const idle = pos.clone();
	idle.turn = other(attacker);
	const standing = bestCapture(idle)?.gain ?? 0;

	return cap.gain - Math.max(0, counter - standing);
}

/**
 * The attacker's best capture ANYWHERE EXCEPT the target square, net of the
 * answer to it.
 *
 * This exists to price what a defensive move costs somewhere else, and it is
 * used only as a DIFFERENCE — what the position offers after the reply, minus
 * what it offered before. That restriction is deliberate and it is the whole
 * lesson of race.ts: a number taken from the whole board is an answer about the
 * whole board, and printing it as an answer about one square is how "take it
 * now, a rook" appeared under a square nothing attacked. As a difference it is
 * a different quantity — the consequence of the move that was just played.
 */
function elsewhere(pos: Chess, target: Square, attacker: Color): number {
	if (pos.turn !== attacker) return 0;
	const cap = bestCapture(pos, makeSquare(target));
	if (!cap) return 0;
	const from = parseSquare(cap.from);
	const to = parseSquare(cap.to);
	if (from === undefined || to === undefined) return 0;
	const after = pos.clone();
	try {
		after.play({ from, to });
	} catch {
		return 0;
	}
	return cap.gain - (bestCapture(after, cap.to)?.gain ?? 0);
}

/**
 * What the attacker still collects after a defensive move, and with which
 * capture.
 *
 * Two ways the plan can pay: the exchange at the square itself, or the hole the
 * defensive move left behind it. Both are needed. A pinned knight that jumps
 * away has not escaped — it has handed over whatever stood behind it — and
 * pricing the square alone called that a free escape, which is the single
 * reason this project's first fixture read 'not winnable' for a won piece.
 *
 * `already` is what was hanging elsewhere BEFORE they moved, so a reply is only
 * ever charged for what it exposed itself.
 */
function collect(
	pos: Chess,
	target: Square,
	attacker: Color,
	already: number,
	/** Where the prize went, when the reply was the prize moving. */
	ranTo?: Square,
): { leaves: number; answer?: Spoiler['answer'] } {
	const here = takeAt(pos, target, attacker);
	const exposed = elsewhere(pos, target, attacker) - already;

	if (here >= exposed) {
		const cap = here > 0 ? captureOn(pos, target) : null;
		const piece = cap ? pos.board.get(parseSquare(cap.from) as Square) : null;
		return {
			leaves: here,
			...(cap && piece
				? {
						answer: {
							text: moveText(piece.role, attacker, cap.from, cap.to, true),
							squares: [cap.from, cap.to] as [string, string],
							at: 'target' as const,
						},
					}
				: {}),
		};
	}

	const cap = exposed > 0 ? bestCapture(pos, makeSquare(target)) : null;
	const piece = cap ? pos.board.get(parseSquare(cap.from) as Square) : null;
	// Taking the prize on the square it ran to is a chase, not an exposure.
	// Calling it "collects what was standing behind it" produced the sentence
	// "♞g4×f2 lets ♔g1×f2 collect what was standing behind it", which describes
	// an ordinary recapture as a discovered attack.
	const at =
		cap && ranTo !== undefined && cap.to === makeSquare(ranTo) ? ('chase' as const) : ('elsewhere' as const);
	return {
		leaves: exposed,
		...(cap && piece
			? {
					answer: {
						text: moveText(piece.role, attacker, cap.from, cap.to, true),
						squares: [cap.from, cap.to] as [string, string],
						at,
					},
				}
			: {}),
	};
}

/**
 * Which of the three failure modes this defensive move is — or none of them.
 *
 * 'quiet' matters as much as the other three. Calling every ordinary move
 * "forcing" made the best-try line report a random pawn push as the defence,
 * and a label that fits everything explains nothing. `spoils` says whether the
 * move actually changed the answer; a move that changed nothing and is neither
 * an escape nor a defence is simply quiet.
 */
function classify(
	before: Chess,
	move: { from: Square; to: Square },
	after: Chess,
	target: Square,
	spoils: boolean,
): SpoilerKind {
	if (move.from === target) return 'escape';
	if (after.isCheck()) return 'forcing';
	// Did it join the defence of the square? Measured, not guessed: take the
	// fold before and after and see whether the number moved.
	const attacker = other(before.turn);
	if (foldAt(after.board, target, attacker).value < foldAt(before.board, target, attacker).value) {
		return 'defender';
	}
	return spoils ? 'forcing' : 'quiet';
}

/**
 * The knot at `target`, rung by rung.
 *
 * `attacker` is the side trying to win material there; the position's own side
 * to move decides whether any of it is a claim at all.
 */
export function knot(pos: Chess, target: Square, attacker: Color, maxTempi = 2): Knot {
	const piece = pos.board.get(target);
	const prize = piece ? { role: piece.role, colour: piece.color, value: VALUE[piece.role] } : null;

	const att = arrivals(pos, target, attacker, maxTempi);
	const def = arrivals(pos, target, other(attacker), maxTempi);

	const rungs: Rung[] = [];

	for (let k = 0; k <= maxTempi; k++) {
		const a = att.filter((u) => u.arrival <= k && u.available);
		const d = def.filter((u) => u.arrival <= k && u.available);

		const fold = prize
			? foldAt(pos.board, target, attacker, {
					extraAttackers: a.filter((u) => u.arrival > 0).map((u) => parseSquare(u.from) as Square),
					extraDefenders: d.filter((u) => u.arrival > 0).map((u) => parseSquare(u.from) as Square),
				})
			: { value: 0, steps: [], depth: 0 };

		// One tempo is ONE move, so at k = 1 exactly one attacker joins and the
		// bill is that one move's route cost. Summing every unit that could have
		// arrived charged the plan for pieces it never moved — in preset #7 that
		// was 320 centipawns of imaginary travel against a pawn push, and it is
		// why a won knight read as nothing. From k = 2 this stays a sum, and
		// stays labelled a count rather than a claim.
		//
		// Clamped at zero on purpose. A route that grabs a pawn on the way has a
		// NEGATIVE cost, and letting that fund the claim is how "the bishop on b5
		// is worth 0.2 pawns — nothing changes hands" got printed: the material
		// was real and it was somewhere else. A build-up move that also wins
		// something is a good move; it is not evidence about this square.
		const spent =
			k === 1
				? 0 // replaced below by the cost of the move actually chosen
				: a.filter((u) => u.arrival > 0).reduce((t, u) => t + Math.max(0, u.routeCost), 0);
		const count = fold.value - spent;

		const participants = { attackers: a, defenders: d };
		const base: Omit<
			Rung,
			'move' | 'survives' | 'spoilers' | 'bestTry' | 'escapeTry' | 'holds'
		> = {
			k,
			participants,
			fold,
			spent,
			count,
		};

		// ---------------------------------------------------------------
		// k = 0 — nobody gets a move. The only question left is legality:
		// the fold is arithmetic on a board and does not know whether the
		// capture can actually be played.
		// ---------------------------------------------------------------
		if (k === 0) {
			const survives = takeAt(pos, target, attacker);
			const spoilers: Spoiler[] = [];
			if (fold.value > 0 && survives <= 0) {
				const cap = captureOn(pos, target);
				spoilers.push({
					kind: 'illegal',
					move: '—',
					squares: [makeSquare(target), makeSquare(target)],
					leaves: survives,
					why:
						pos.turn !== attacker
							? 'It is not their move, so nothing can be taken yet.'
							: cap
								? `The capture is legal but does not pay once the other side answers: it leaves ${survives}.`
								: 'The count says the square is winnable, but no legal capture on it exists — an attacker is pinned, or the king is in check.',
				});
			}
			rungs.push({
				...base,
				move: null,
				survives,
				spoilers,
				bestTry: null,
				escapeTry: null,
				holds: survives > 0,
			});
			continue;
		}

		// ---------------------------------------------------------------
		// k = 1 — the attacker commits one piece, the defender answers once.
		// Both are enumerated. The best build-up move is the one whose worst
		// answer is least bad, and the answers that beat the others are the
		// spoiler list.
		// ---------------------------------------------------------------
		if (k === 1 && prize && pos.turn === attacker) {
			let bestMove: Rung['move'] = null;
			let bestSurvives = -Infinity;
			let bestSpoilers: Spoiler[] = [];
			let bestAnswer: Spoiler | null = null;
			let bestEscape: Spoiler | null = null;
			let bestFold = fold;
			let bestSpent = 0;

			for (const u of a) {
				if (u.arrival !== 1 || !u.via) continue;
				const from = parseSquare(u.from) as Square;
				const to = parseSquare(u.via) as Square;
				const built = pos.clone();
				try {
					built.play({ from, to });
				} catch {
					// The route was found on a frozen board and may be illegal
					// in the real position. Skipping it is right, and it is why
					// arrival is a claim about geometry, not about play.
					continue;
				}

				// What the defender can do about it. Every legal reply, not
				// only "bring another defender" — a check repairs a pin with
				// tempo, and the first version of this could not see that.
				//
				// If they pass, this is what the plan is worth. Every reply is
				// then priced against that, and the ones that beat it are the
				// spoiler list.
				//
				// The turn has to be handed back deliberately. `built` is the
				// position after our build-up move, so it is THEIR move; asking
				// "what do we collect" of it returns zero for every plan ever
				// made, which made the whole table read 'nothing'.
				const passed = built.clone();
				passed.turn = attacker;
				const ifTheyPass = takeAt(passed, target, attacker);

				// What was already hanging elsewhere before they moved. Every
				// reply is priced against this baseline, so a reply is only
				// charged for what IT exposed.
				const already = elsewhere(passed, target, attacker);
				const answers: Spoiler[] = [];
				for (const [rf, rts] of built.allDests()) {
					const rp = built.board.get(rf);
					if (!rp) continue;
					for (const rt of rts) {
						const replied = built.clone();
						try {
							replied.play({ from: rf, to: rt });
						} catch {
							continue;
						}
						const { leaves, answer } = collect(
							replied,
							target,
							attacker,
							already,
							rf === target ? rt : undefined,
						);
						const kind = classify(
							built,
							{ from: rf, to: rt },
							replied,
							target,
							leaves < ifTheyPass,
						);
						const text = moveText(
							rp.role,
							rp.color,
							makeSquare(rf),
							makeSquare(rt),
							built.board.get(rt) !== undefined,
						);
						answers.push({
							kind,
							move: text,
							squares: [makeSquare(rf), makeSquare(rt)],
							leaves,
							why: reason(kind, text, leaves, answer),
							...(answer ? { answer } : {}),
						});
					}
				}
				// Worst-for-the-attacker first; among equals, the move that
				// teaches something. A tie broken by move-generation order put a
				// random pawn push forward as "their best try", which is true
				// and useless.
				const RANK: Record<SpoilerKind, number> = {
					escape: 0,
					defender: 1,
					forcing: 2,
					illegal: 3,
					quiet: 4,
				};
				answers.sort((x, y) => x.leaves - y.leaves || RANK[x.kind] - RANK[y.kind]);
				const worst = answers.length ? answers[0].leaves : ifTheyPass;
				// A spoiler is an answer that beats passing. The rest are tries,
				// and the best of them is kept so a rung that holds can still say
				// what they attempted and why it failed.
				const kinds = new Set<SpoilerKind>();
				const spoilers = answers
					.filter((s) => s.leaves < ifTheyPass)
					.filter((s) => {
						if (kinds.has(s.kind)) return false;
						kinds.add(s.kind);
						return true;
					});

				const survives = worst - Math.max(0, u.routeCost);
				if (survives > bestSurvives) {
					bestSurvives = survives;
					// The rung's own count, for the one move it proposes.
					bestFold = foldAt(pos.board, target, attacker, {
						extraAttackers: [from],
						extraDefenders: d
							.filter((x) => x.arrival > 0)
							.map((x) => parseSquare(x.from) as Square),
					});
					bestSpent = Math.max(0, u.routeCost);
					bestMove = {
						role: u.role,
						from: u.from,
						to: u.via,
						text: moveText(u.role, attacker, u.from, u.via, false),
					};
					bestSpoilers = spoilers.slice(0, 4);
					bestAnswer = answers[0] ?? null;
					bestEscape = answers.find((x) => x.kind === 'escape') ?? null;
				}
			}

			rungs.push({
				...base,
				fold: bestFold,
				spent: bestSpent,
				count: bestFold.value - bestSpent,
				move: bestMove,
				survives: bestMove ? bestSurvives : 0,
				spoilers: bestSpoilers,
				bestTry: bestAnswer,
				escapeTry: bestEscape,
				// Both conditions, and the first one is the one the generator
				// forced me to add: the EXCHANGE AT THIS SQUARE has to pay. The
				// exposure term exists to refute a defensive move, not to supply
				// the win — without this gate a plan that wins a knight on the
				// far side of the board came back as "the pawn on g7 is worth a
				// piece", which is exactly the error race.ts was retired for.
				holds: bestMove !== null && bestSurvives > 0 && bestFold.value - bestSpent > 0,
			});
			continue;
		}

		// ---------------------------------------------------------------
		// k >= 2, or it is not the attacker's move — a count, not a claim.
		// ---------------------------------------------------------------
		rungs.push({
			...base,
			move: null,
			survives: null,
			spoilers: [],
			bestTry: null,
			escapeTry: null,
			holds: false,
		});
	}

	const won = rungs.find((r) => r.holds) ?? null;

	return {
		target: makeSquare(target),
		attacker,
		prize,
		rungs,
		at: won ? won.k : null,
		value: won ? (won.survives ?? won.count) : 0,
	};
}

/**
 * The sentence for one defensive move, assembled from what it is, what it
 * leaves, and which capture still collects it.
 *
 * Nothing here is written per-position. Every clause is switched on a computed
 * value, which is the point: a hardcoded explanation is an explanation of the
 * fixture rather than of the algorithm, and the fixtures were the thing that
 * turned out to be wrong.
 */
function reason(
	kind: SpoilerKind,
	move: string,
	leaves: number,
	answer?: Spoiler['answer'],
): string {
	const still = answer
		? answer.at === 'elsewhere'
			? ` ${answer.text} collects what it was shielding`
			: answer.at === 'chase'
				? ` ${answer.text} takes it where it lands`
				: ` ${answer.text} takes it anyway`
		: '';

	switch (kind) {
		case 'escape':
			return leaves > 0
				? `${move} runs, but${still} — ${left(leaves)}`
				: move.includes('×')
					? `${move} — it leaves with tempo, taking something on the way out.`
					: `${move} — it simply leaves, with the same tempo the plan was spending, and nothing is left behind.`;
		case 'defender':
			return leaves > 0
				? `${move} adds a defender, but${still} — ${left(leaves)}`
				: `${move} — a defender arrives in time and the exchange stops paying.`;
		case 'forcing':
			return leaves > 0
				? `${move} is forcing, but${still} — ${left(leaves)}`
				: `${move} — a forcing move, which spends the tempo the plan was counting on.`;
		case 'quiet':
			return `${move} changes nothing here — ${left(leaves)}`;
		case 'illegal':
			return `${move} — ${left(leaves)}`;
	}
}

const left = (n: number): string =>
	n > 0
		? `Still ${n} centipawns left at the square.`
		: n === 0
			? 'Nothing is left at the square.'
			: `Taking anyway costs ${-n} centipawns.`;
