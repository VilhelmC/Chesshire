// When a punishment is finished, and which way.
//
// ---------------------------------------------------------------------------
// Will: "we need to reconsider the punishment stop condition because currently
// the punishments never stop and the arbitrary slip in standing should be
// cumulative (not a maximum relative loss on a single move). … the blunder
// consists of offering an exploitable gift … Punishment means realizing that
// gift instead of squandering it. But how to detect when it has been realized?
// That would seem to be when material has been won corresponding to the
// opponents loss in position … Is remaining exchange played out?"
//
// So the shape of these tests changed with the rule. Every claim now goes
// through a STANDING — evaluation, material, and whether the position is settled
// — because "you are a knight up" and "you are a knight up until they recapture"
// are the same evaluation and the same material, and only one of them is a
// punishment taken.
//
// The case the old rule could not express at all is still here, third block: a
// blunder inside a position you are LOSING.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
	COLLECT_MIN_CP,
	QUIET_MOVES,
	afterMove,
	collectNeeded,
	giveBackLimit,
	offered,
	punishOutcome,
	slip,
	type Punishment,
	type Standing,
} from '../src/domain/punish';

/** They hung a piece: eval jumped to +150, nothing captured yet. */
const HUNG: Punishment = offered({ base: 150, gift: 300, material: 0 });

/** A standing, with the settled-and-nothing-pending case as the default. */
function at(over: Partial<Standing> & { ev: number; material: number }): Standing {
	return { quiet: true, nothingLeft: false, ...over };
}

describe('taking what was offered', () => {
	it('is finished once the material is on the board and nothing is pending', () => {
		// The ordinary case, and what "backed by actual acquisition" means: a piece
		// in hand is the one advantage that cannot evaporate.
		expect(punishOutcome(HUNG, at({ ev: 160, material: 3 }))).toBe('realized');
	});

	it('is NOT finished while the exchange is still going on', () => {
		// Will: "is remaining exchange played out?" The board says +3 the instant
		// after Nxd5; the recapture is on its way. This is the reading that used to
		// end the drill one move early and then print a claim the next move
		// contradicted.
		expect(punishOutcome(HUNG, at({ ev: 160, material: 3, quiet: false }))).toBe('running');
	});

	it('is not finished by winning material while the position collapses', () => {
		// Both halves are needed. A pawn grabbed on the way into a mating net is not
		// a punishment taken — the gift is not held, so nothing has been realized.
		expect(punishOutcome(HUNG, at({ ev: -400, material: 1 }))).toBe('running');
	});

	it('will not close a piece-sized gift for a pawn', () => {
		// Two thirds of 300 is 200, so one pawn is not it. This is the floor and the
		// share doing their job together: a share alone would let a queen blunder be
		// closed by a pawn if the share were low, and a floor alone would accept a
		// pawn for anything.
		expect(punishOutcome(HUNG, at({ ev: 160, material: 1 }))).toBe('running');
		expect(collectNeeded(300)).toBe(200);
		expect(collectNeeded(120)).toBe(COLLECT_MIN_CP);
		expect(collectNeeded(900)).toBe(600);
	});

	it('accepts a conversion worth less than the gift when that is all there was', () => {
		// The fork that wins a knight at the cost of a pawn: 200 collected of a 250
		// gift, with nothing further to take. Demanding the whole gift would leave
		// this phase running for ever, which is the failure being fixed.
		const fork = offered({ base: 0, gift: 250, material: 0 });
		expect(punishOutcome(fork, at({ ev: 30, material: 2 }))).toBe('realized');
	});

	it('tolerates measurement noise rather than ending on it', () => {
		// Two searches of one position at different depths differ by a few
		// centipawns, and an ending triggered by that is indistinguishable from one
		// triggered by a mistake.
		expect(punishOutcome(HUNG, at({ ev: 130, material: 3 }))).toBe('realized');
	});
});

describe('giving it back, which can only happen cumulatively', () => {
	// Will: "the arbitrary slip in standing should be cumulative (not a maximum
	// relative loss on a single move)."
	//
	// And it is not a preference: every punish move has to be within 60cp of the
	// engine's best or it is refused and replayed, so no single accepted move can
	// hand back a 300cp gift. A per-move test for squandering cannot fire at all.
	it('does not end on one allowed slip', () => {
		const p = afterMove(HUNG, 55, at({ ev: 95, material: 0 }));
		expect(punishOutcome(p, at({ ev: 95, material: 0 }))).toBe('running');
	});

	it('ends once the slips add up to a share of the gift', () => {
		let p = HUNG;
		const standing = at({ ev: 100, material: 0 });
		const outcomes: string[] = [];
		for (let i = 0; i < 4; i++) {
			p = afterMove(p, 55, standing);
			outcomes.push(punishOutcome(p, standing));
		}
		// 150 is half of 300 — `annotate`'s rule, shared so the trainer and the
		// review cannot disagree about the same moment.
		expect(giveBackLimit(300)).toBe(150);
		expect(outcomes).toEqual(['running', 'running', 'squandered', 'squandered']);
	});

	it('does not accumulate search noise into a squandering', () => {
		// The floor exists because the slips are now ADDED UP: without it, ten moves
		// of a long conversion accumulate fifty centipawns of jitter and the drill
		// reports that you threw it away.
		let p = HUNG;
		const standing = at({ ev: 150, material: 0 });
		for (let i = 0; i < 40; i++) p = afterMove(p, 8, standing);
		expect(p.given).toBe(0);
		expect(punishOutcome(p, standing)).toBe('running');
		expect(slip(8)).toBe(0);
		expect(slip(40)).toBe(40);
	});

	it('counts the whole slip once it is past the floor, not the excess', () => {
		expect(afterMove(HUNG, 45, at({ ev: 100, material: 0 })).given).toBe(45);
	});
});

describe('a gift with no capture in it', () => {
	// A wrecked king, a bishop locked in, doubled pawns accepted. Will: end these
	// "when it goes quiet". Nothing is collected, so nothing is realized — and
	// without this ending the phase could only ever be squandered, which is what
	// made positional blunders unwinnable drills.
	const POSITIONAL = offered({ base: 60, gift: 120, material: 0 });
	const still = at({ ev: 70, material: 0, nothingLeft: true });

	it('ends as kept once the position has been quiet and the gift has held', () => {
		let p = POSITIONAL;
		for (let i = 0; i < QUIET_MOVES - 1; i++) p = afterMove(p, 0, still);
		expect(punishOutcome(p, still)).toBe('running');
		p = afterMove(p, 0, still);
		expect(punishOutcome(p, still)).toBe('kept');
	});

	it('does not end while something is still coming', () => {
		// `nothingLeft` false: the engine's line wins material in the next few
		// moves, so the conversion has not finished — and a trapped piece that takes
		// four moves to collect is exactly this case, not a quiet position.
		let p = POSITIONAL;
		for (let i = 0; i < 6; i++) p = afterMove(p, 0, at({ ev: 70, material: 0 }));
		expect(punishOutcome(p, at({ ev: 70, material: 0 }))).toBe('running');
	});

	it('needs the quiet moves to be consecutive', () => {
		let p = afterMove(POSITIONAL, 0, still);
		p = afterMove(p, 0, at({ ev: 70, material: 0, quiet: false }));
		expect(p.quiet).toBe(0);
		expect(punishOutcome(p, still)).toBe('running');
	});

	it('is not kept if the gift has gone', () => {
		let p = POSITIONAL;
		const lost = at({ ev: -200, material: 0, nothingLeft: true });
		for (let i = 0; i < QUIET_MOVES; i++) p = afterMove(p, 0, lost);
		expect(punishOutcome(p, lost)).not.toBe('kept');
	});
});

describe('a blunder inside a position you are losing', () => {
	// −2.0 to −0.5. The gift is real; the position is not won and will not be.
	const LOSING = offered({ base: -50, gift: 150, material: -3 });

	it('completes by collecting what they gave, not by reaching a winning score', () => {
		// The rule this replaced was `ev >= 250`, which cannot happen here — so a
		// perfectly punished blunder ran until it was squandered instead.
		expect(punishOutcome(LOSING, at({ ev: -40, material: -2 }))).toBe('realized');
	});

	it('measures the give-back against the gift, not against zero', () => {
		let p = LOSING;
		const standing = at({ ev: -150, material: -3 });
		for (let i = 0; i < 2; i++) p = afterMove(p, 50, standing);
		// Handing back 100 of 150 is squandering it whatever the sign of the score.
		expect(punishOutcome(p, standing)).toBe('squandered');
	});

	it('is still running while most of the gift is intact', () => {
		expect(punishOutcome(LOSING, at({ ev: -90, material: -3 }))).toBe('running');
	});
});

describe('mate', () => {
	it('is realized whatever the material says', () => {
		// The one realization that owes nothing to a capture: there is no material to
		// bank and the gift could not be more completely collected.
		expect(punishOutcome(HUNG, at({ ev: 9900, material: -5, quiet: false }))).toBe('realized');
	});
});

describe('every phase ends', () => {
	it('has no move count to stop it, and needs none', () => {
		// Will: "we should never stop a punishment before it is realized." There is
		// no ply argument here. What replaces the cap is that each of the three
		// endings is reachable: collect it, give it back, or run out of things to
		// convert.
		let p = HUNG;
		const standing = at({ ev: 150, material: 0 });
		for (let i = 0; i < 50; i++) {
			p = afterMove(p, 0, standing);
			expect(punishOutcome(p, standing)).toBe('running');
		}
		// …and the same fifty moves in a position that has gone quiet do end.
		expect(punishOutcome(afterMove(afterMove(p, 0, { ...standing, nothingLeft: true }), 0, { ...standing, nothingLeft: true }), standing)).toBe('kept');
	});

	it('records a gift of zero as a phase that can still end', () => {
		// The fallback when a run reaches the punish phase with no record of what
		// was offered. It used to be rebuilt from the current position on every
		// move, which pinned every outcome at `running` for ever.
		const p = offered({ base: 0, gift: 0, material: 0 });
		expect(punishOutcome(p, at({ ev: 10, material: 1 }))).toBe('realized');
		expect(punishOutcome(afterMove(p, 70, at({ ev: -70, material: 0 })), at({ ev: -70, material: 0 }))).toBe(
			'squandered',
		);
	});
});
