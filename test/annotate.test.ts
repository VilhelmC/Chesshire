// Both sides of a reviewed game.
//
// The bug that started this: a game played as Black showed scores only on
// White's moves. Two independent off-by-ones — one in whose move a ply is, one
// in how the two storage formats index their evaluations — and they cancelled
// exactly often enough to look like a display quirk. So the side assignment is
// tested from both colours here, deliberately.

import { describe, it, expect } from 'vitest';
import {
	annotate,
	describe as describeMove,
	lossesOf,
	punishTally,
	signed,
	GIVEBACK_MIN_CP,
} from '../src/domain/annotate';

// evals[i] is the position after i plies, our point of view.
const sides = (evals: (number | null)[], c: 'w' | 'b') => annotate(evals, c).map((a) => a.side);

describe('whose move is it', () => {
	it('gives White the odd plies when we are White', () => {
		expect(sides([15, 20, 10, 25], 'w')).toEqual(['us', 'them', 'us']);
	});

	it('gives us the even plies when we are Black', () => {
		// The case that was broken on screen. Ply 1 is White's, and White is not us.
		expect(sides([15, 20, 10, 25], 'b')).toEqual(['them', 'us', 'them']);
	});
});

describe('loss', () => {
	it('charges us a fall in our own evaluation', () => {
		expect(annotate([15, -85], 'w')[0].loss).toBe(100);
	});

	it('charges them a rise in it', () => {
		// Our-POV throughout: their move going well for us is their loss.
		expect(annotate([15, 15, 215], 'w')[1].loss).toBe(200);
	});

	it('never charges a mover for improving', () => {
		expect(annotate([15, 200], 'w')[0].loss).toBe(0);
	});

	it('reports an unmeasured ply as null rather than as a perfect move', () => {
		const a = annotate([15, null, 20], 'w');
		expect(a[0].loss).toBeNull();
		expect(a[0].quality).toBeNull();
		expect(a[0].text).toBe('Not evaluated.');
	});

	it('treats a missing starting evaluation as the known starting value', () => {
		// evals[0] absent is normal — nothing measured the initial position,
		// because it does not need measuring.
		expect(annotate([null, -85], 'w')[0].loss).toBe(100);
	});
});

describe('the chance to punish', () => {
	// 15 -> 300 on their move: we are clearly better and their move is what did
	// it, which is the trainer's own definition of a blunder worth drilling.
	const gift = [15, 15, 300] as (number | null)[];

	it('marks their blunder as an opportunity', () => {
		const a = annotate(gift, 'w');
		expect(a[1].opportunity).toBe(true);
		expect(a[1].text).toContain('chance to punish');
	});

	it('does not call our own bad move an opportunity', () => {
		expect(annotate([15, -300], 'w')[0].opportunity).toBe(false);
	});

	it('does not call their small slip an opportunity', () => {
		// A 50cp drift leaves nothing to punish, and calling it a chance would
		// train the reader to ignore the word.
		expect(annotate([15, 15, 65], 'w')[1].opportunity).toBe(false);
	});

	it('marks the reply that hands most of it back', () => {
		const a = annotate([...gift, 100], 'w');
		expect(a[2].missedPunish).toBe(true);
		expect(a[2].text).toContain('straight back');
	});

	it('does not mark a reply that keeps the advantage', () => {
		const a = annotate([...gift, 290], 'w');
		expect(a[2].missedPunish).toBe(false);
	});

	it('scales the test to the size of the gift', () => {
		// Half of a 285cp gift is ~142cp, so a 100cp slip is not "missing it".
		expect(annotate([...gift, 200], 'w')[2].missedPunish).toBe(false);
		// But half of a small gift would be below the floor, and a give-back
		// under GIVEBACK_MIN_CP is an inaccuracy rather than a squandered game.
		const small = [15, 15, 140, 140 - (GIVEBACK_MIN_CP - 10)] as (number | null)[];
		expect(annotate(small, 'w')[2].missedPunish).toBe(false);
	});

	it('only looks at the move immediately after', () => {
		// Two moves later is a different position and a different question.
		const a = annotate([...gift, 295, 100], 'w');
		expect(a[3].missedPunish).toBe(false);
	});

	it('counts what was offered and what was dropped', () => {
		expect(punishTally(annotate([...gift, 100], 'w'))).toEqual({ offered: 1, missed: 1 });
	});
});

describe('commentary', () => {
	it('speaks about their moves too, rather than falling silent', () => {
		// 100cp of drift that still leaves us only barely better: worth saying,
		// but not a position to drill, because there is nothing decisive to find.
		const text = annotate([15, 15, 115], 'w')[1].text;
		expect(text.toLowerCase()).toContain('their inaccuracy');
	});

	it('carries the evaluation alongside the label', () => {
		// The label alone says how bad; the number says where that leaves you.
		expect(annotate([15, -85], 'w')[0].text).toContain('−0.9');
	});

	it('reads evaluations the way a chess player does', () => {
		expect(signed(140)).toBe('+1.4');
		expect(signed(-30)).toBe('−0.3');
		expect(signed(0)).toBe('+0.0');
	});

	it('says nothing about a move it could not measure', () => {
		expect(
			describeMove({ side: 'us', loss: null, after: null, opportunity: false, missedPunish: false }),
		).toBe('Not evaluated.');
	});
});

describe('lossesOf', () => {
	it('separates the two players', () => {
		const a = annotate([15, -85, 100, 60], 'w');
		expect(lossesOf(a, 'us')).toEqual([100, 40]);
		expect(lossesOf(a, 'them')).toEqual([185]);
	});

	it('leaves out the plies it could not measure', () => {
		expect(lossesOf(annotate([15, null, 20], 'w'), 'us')).toEqual([]);
	});
});
