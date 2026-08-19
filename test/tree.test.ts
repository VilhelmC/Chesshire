import { describe, it, expect } from 'vitest';
import { buildTree, accuracyOf, weakSpots, deepestKnown, flatten, type TreeAnswer } from '../src/domain/tree';

let t = 0;
const ans = (
	path: string[],
	correct: boolean,
	extra: Partial<TreeAnswer> = {},
): TreeAnswer => ({ path, correct, assisted: false, phase: 'book', ts: ++t, ...extra });

const TRUNK = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];

describe('buildTree', () => {
	it('shares the trunk between branches instead of duplicating it', () => {
		const { root } = buildTree([
			ans(['e4', 'e5', 'Nf3'], true),
			ans([...TRUNK, 'Nf6'], true),
			ans([...TRUNK, 'Bc5'], false),
		]);
		// One e4, one e5, one Nf3 — not three copies of the same prefix.
		expect(root.children.length).toBe(1);
		expect(root.children[0].san).toBe('e4');
		const nf3 = root.children[0].children[0].children[0];
		expect(nf3.san).toBe('Nf3');
		expect(nf3.children.length).toBe(1);
	});

	it('records an answer at the position it was given, not on its ancestors', () => {
		const { root } = buildTree([ans([...TRUNK, 'Nf6'], false)]);
		const leaf = flatten(root).find((n) => n.san === 'Nf6')!;
		expect(leaf.own.attempts).toBe(1);
		const trunkNode = flatten(root).find((n) => n.san === 'Nf3')!;
		expect(trunkNode.own.attempts).toBe(0);
	});

	it('folds subtree numbers up, so a collapsed node reports everything below it', () => {
		const { root } = buildTree([
			ans([...TRUNK, 'Nf6'], true),
			ans([...TRUNK, 'Nf6', 'Ng5'], false),
			ans([...TRUNK, 'Bc5'], true),
		]);
		const bc4 = flatten(root).find((n) => n.san === 'Bc4')!;
		expect(bc4.own.attempts).toBe(0);
		expect(bc4.total.attempts).toBe(3);
		expect(bc4.total.correct).toBe(2);

		const nf6 = flatten(root).find((n) => n.san === 'Nf6')!;
		expect(nf6.total.attempts).toBe(2);
	});

	it('tags each node with the side that played the move', () => {
		const { root } = buildTree([ans(TRUNK, true)]);
		const byPly = new Map(flatten(root).map((n) => [n.ply, n.colour]));
		expect(byPly.get(1)).toBe('w');
		expect(byPly.get(2)).toBe('b');
		expect(byPly.get(5)).toBe('w');
	});

	it('excludes assisted answers from accuracy but keeps the count', () => {
		const { root } = buildTree([
			ans(['e4'], true),
			ans(['e4'], false, { assisted: true }),
		]);
		const e4 = root.children[0];
		expect(e4.own.attempts).toBe(1);
		expect(e4.own.assisted).toBe(1);
		expect(accuracyOf(e4.own)).toBe(1);
	});

	it('ignores free play, which is not a recall question', () => {
		const { root } = buildTree([ans(['e4'], false, { phase: 'freeplay' })]);
		expect(root.children[0].own.attempts).toBe(0);
	});

	it('counts punishment separately as well as overall', () => {
		const { root } = buildTree([
			ans(['e4', 'f6'], true, { phase: 'punish' }),
			ans(['e4', 'f6'], false, { phase: 'punish' }),
		]);
		const n = flatten(root).find((x) => x.san === 'f6')!;
		expect(n.own.punishAttempts).toBe(2);
		expect(n.own.punishCorrect).toBe(1);
		expect(n.own.attempts).toBe(2);
	});

	it('drops answers with no path rather than piling them on the root', () => {
		const { root, unplaced } = buildTree([
			ans(['e4'], true),
			{ path: undefined as unknown as string[], correct: true, assisted: false, phase: 'book', ts: 1 },
		]);
		expect(unplaced).toBe(1);
		expect(root.own.attempts).toBe(0);
		expect(root.total.attempts).toBe(1);
	});

	it('orders branches by how much they have been practised', () => {
		const { root } = buildTree([
			ans(['e4', 'c5'], true),
			ans(['e4', 'e5'], true),
			ans(['e4', 'e5'], true),
			ans(['e4', 'e5'], false),
		]);
		expect(root.children[0].children.map((c) => c.san)).toEqual(['e5', 'c5']);
	});

	it('is empty-safe', () => {
		const { root } = buildTree([]);
		expect(root.children).toEqual([]);
		expect(accuracyOf(root.total)).toBeNull();
	});
});

describe('weakSpots', () => {
	it('reports the deepest failing node, not its ancestors', () => {
		const answers: TreeAnswer[] = [];
		// Solid to move 4, falls apart at move 5.
		for (let i = 0; i < 5; i++) answers.push(ans(['e4', 'e5', 'Nf3'], true));
		for (let i = 0; i < 5; i++) answers.push(ans([...TRUNK, 'Nf6', 'Ng5'], false));
		for (let i = 0; i < 5; i++) answers.push(ans([...TRUNK, 'Nf6'], false));

		const { root } = buildTree(answers);
		const weak = weakSpots(root);
		expect(weak.map((n) => n.san)).toContain('Ng5');
		// Nf6 also fails, but a failing descendant already accounts for it.
		expect(weak.map((n) => n.san)).not.toContain('Nf6');
	});

	it('ignores nodes with too little data to mean anything', () => {
		const { root } = buildTree([ans(['e4', 'e5'], false)]);
		expect(weakSpots(root)).toEqual([]);
		expect(weakSpots(root, { minAttempts: 1 }).length).toBe(1);
	});

	it('ignores nodes that are going fine', () => {
		const answers = Array.from({ length: 6 }, () => ans(['e4', 'e5'], true));
		const { root } = buildTree(answers);
		expect(weakSpots(root)).toEqual([]);
	});
});

describe('deepestKnown', () => {
	it('is the deepest ply ever answered correctly, unassisted', () => {
		const { root } = buildTree([
			ans(['e4', 'e5', 'Nf3'], true),
			ans([...TRUNK, 'Nf6'], false),
		]);
		expect(deepestKnown(root)).toBe(3);
	});

	it('is zero when nothing has been answered', () => {
		expect(deepestKnown(buildTree([]).root)).toBe(0);
	});
});
