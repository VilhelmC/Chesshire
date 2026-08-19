// Progress, shaped like the opening rather than like a list.
//
// ---------------------------------------------------------------------------
// The flat version reported per named line, and lines that share a prefix
// double-counted every answer in it: an answer to 2.Nf3 belonged to all five,
// so "Giuoco Piano: 78%" was mostly measuring moves that have nothing to do
// with the Giuoco. Worse, it could not answer the question you actually have —
// *where* does my knowledge run out — because the shared trunk was averaged in
// with the branch.
//
// Positions form a tree, so progress is a tree. Each node is a position reached
// by a specific sequence of moves, carrying what happened AT it and, folded up
// from below, what happened anywhere beneath it. A collapsed node therefore
// reports its whole subtree honestly, and expanding it is what separates "I
// know the Italian" from "I know the first four moves of the Italian".
// ---------------------------------------------------------------------------

export type TreeAnswer = {
	/** SAN moves played before this answer. Its position in the tree. */
	path: string[];
	correct: boolean;
	assisted: boolean;
	phase: 'book' | 'punish' | 'freeplay';
	ts: number;
};

export type TreeStats = {
	/** Answers that count towards accuracy: unassisted, book or punish. */
	attempts: number;
	correct: number;
	/** Excluded from accuracy entirely — see domain/progress.ts. */
	assisted: number;
	punishAttempts: number;
	punishCorrect: number;
	lastSeen: number | null;
};

export type TreeNode = {
	/** Full SAN path from the initial position. */
	path: string[];
	/** The move that reached this node; null at the root. */
	san: string | null;
	ply: number;
	/** Whose move produced this node. */
	colour: 'w' | 'b' | null;
	/** What happened at this exact position. */
	own: TreeStats;
	/** This node and everything below it. What a collapsed row reports. */
	total: TreeStats;
	children: TreeNode[];
};

const empty = (): TreeStats => ({
	attempts: 0,
	correct: 0,
	assisted: 0,
	punishAttempts: 0,
	punishCorrect: 0,
	lastSeen: null,
});

function record(s: TreeStats, a: TreeAnswer): void {
	s.lastSeen = Math.max(s.lastSeen ?? 0, a.ts);
	if (a.assisted) {
		s.assisted++;
		return;
	}
	if (a.phase === 'freeplay') return; // not a recall question
	s.attempts++;
	if (a.correct) s.correct++;
	if (a.phase === 'punish') {
		s.punishAttempts++;
		if (a.correct) s.punishCorrect++;
	}
}

function merge(into: TreeStats, from: TreeStats): void {
	into.attempts += from.attempts;
	into.correct += from.correct;
	into.assisted += from.assisted;
	into.punishAttempts += from.punishAttempts;
	into.punishCorrect += from.punishCorrect;
	if (from.lastSeen !== null) into.lastSeen = Math.max(into.lastSeen ?? 0, from.lastSeen);
}

/**
 * Build the tree.
 *
 * Answers whose path is unknown are dropped rather than piled onto the root —
 * rows written before the path was recorded cannot be placed, and placing them
 * anywhere would make the root's numbers describe positions they never came
 * from. The caller is expected to report how many were dropped.
 */
export function buildTree(answers: TreeAnswer[]): { root: TreeNode; unplaced: number } {
	const root: TreeNode = {
		path: [],
		san: null,
		ply: 0,
		colour: null,
		own: empty(),
		total: empty(),
		children: [],
	};

	let unplaced = 0;

	for (const a of answers) {
		if (!Array.isArray(a.path)) {
			unplaced++;
			continue;
		}
		let node = root;
		for (let i = 0; i < a.path.length; i++) {
			const san = a.path[i];
			let child = node.children.find((c) => c.san === san);
			if (!child) {
				child = {
					path: a.path.slice(0, i + 1),
					san,
					ply: i + 1,
					colour: i % 2 === 0 ? 'w' : 'b',
					own: empty(),
					total: empty(),
					children: [],
				};
				node.children.push(child);
			}
			node = child;
		}
		record(node.own, a);
	}

	rollUp(root);
	sort(root);
	return { root, unplaced };
}

/** Fold every subtree's numbers into its parent. */
function rollUp(node: TreeNode): TreeStats {
	node.total = empty();
	merge(node.total, node.own);
	for (const c of node.children) merge(node.total, rollUp(c));
	return node.total;
}

/**
 * Most-practised first.
 *
 * Not alphabetical and not by accuracy: the tree is for finding where to work,
 * and a branch you have played twice is noise beside one you have played fifty
 * times. Ties break towards the weaker branch, which is the one worth opening.
 */
function sort(node: TreeNode): void {
	node.children.sort(
		(a, b) => b.total.attempts - a.total.attempts || accuracy(a.total) - accuracy(b.total),
	);
	for (const c of node.children) sort(c);
}

/** Fraction correct, or null when nothing measurable happened. */
export function accuracyOf(s: TreeStats): number | null {
	return s.attempts ? s.correct / s.attempts : null;
}

function accuracy(s: TreeStats): number {
	return s.attempts ? s.correct / s.attempts : 1;
}

/**
 * Where the tree stops being known.
 *
 * The deepest nodes with enough attempts to mean anything and an accuracy below
 * the threshold — the answer to "what should I train next", which is the whole
 * reason for the page. Ancestors of a returned node are omitted: if you fail at
 * move 6, saying you also fail "somewhere in the Italian" adds nothing.
 */
export function weakSpots(
	root: TreeNode,
	opts: { minAttempts?: number; below?: number; limit?: number } = {},
): TreeNode[] {
	const minAttempts = opts.minAttempts ?? 3;
	const below = opts.below ?? 0.7;
	const found: TreeNode[] = [];

	const walk = (n: TreeNode): boolean => {
		// Depth first, so a failing child suppresses its parent.
		let childFailed = false;
		for (const c of n.children) childFailed = walk(c) || childFailed;

		const acc = accuracyOf(n.own);
		const failing = n.own.attempts >= minAttempts && acc !== null && acc < below;
		if (failing && !childFailed) found.push(n);
		return failing || childFailed;
	};

	for (const c of root.children) walk(c);

	return found
		.sort((a, b) => (accuracyOf(a.own) ?? 1) - (accuracyOf(b.own) ?? 1))
		.slice(0, opts.limit ?? 8);
}

/** Every node, depth first — for counting and for search. */
export function flatten(node: TreeNode): TreeNode[] {
	return [node, ...node.children.flatMap(flatten)];
}

/** Deepest ply with at least one correct unassisted answer. */
export function deepestKnown(root: TreeNode): number {
	return flatten(root)
		.filter((n) => n.own.correct > 0)
		.reduce((d, n) => Math.max(d, n.ply), 0);
}
