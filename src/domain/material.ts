// What is off the board.
//
// Shown rather than left to be counted (§1.1). "You are a piece up" is a fact
// the app already knows from the FEN, and making the learner derive it from
// thirty-two squares is attention spent on bookkeeping.
//
// Captured pieces are computed as `initial − present`, which is what every
// chess site does and which promotions distort: promote a pawn and you appear
// to have "captured" one of your own. `promotions` reports that separately
// rather than letting it silently corrupt the count.

export type Colour = 'w' | 'b';
export type Role = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export const VALUE: Record<Role, number> = {
	pawn: 1,
	knight: 3,
	bishop: 3,
	rook: 5,
	queen: 9,
	king: 0,
};

/** Order pieces are listed in: cheapest first, as on every board readout. */
export const ORDER: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

const INITIAL: Record<Role, number> = {
	pawn: 8,
	knight: 2,
	bishop: 2,
	rook: 2,
	queen: 1,
	king: 1,
};

const ROLE_OF: Record<string, Role> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king',
};

export type Counts = Record<Role, number>;

const empty = (): Counts => ({ pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 });

/** Pieces present on the board, per colour. */
export function census(fen: string): { w: Counts; b: Counts } {
	const board = fen.split(' ')[0] ?? '';
	const out = { w: empty(), b: empty() };
	for (const ch of board) {
		const role = ROLE_OF[ch.toLowerCase()];
		if (!role) continue;
		out[ch === ch.toUpperCase() ? 'w' : 'b'][role]++;
	}
	return out;
}

export type MaterialReport = {
	/** Their pieces we have taken, cheapest first, as roles repeated by count. */
	weTook: Role[];
	/** Ours they have taken. */
	theyTook: Role[];
	/** Our material minus theirs, in pawns. Positive is good for us. */
	balance: number;
	/** Extra pieces beyond the starting set, which only promotion can produce. */
	promotions: { ours: number; theirs: number };
};

export function materialReport(fen: string, ourColour: Colour): MaterialReport {
	const c = census(fen);
	const ours = c[ourColour];
	const theirs = c[ourColour === 'w' ? 'b' : 'w'];

	const missing = (have: Counts): Role[] => {
		const out: Role[] = [];
		for (const role of ORDER) {
			// Clamped: a promotion makes `present` exceed the initial count, and a
			// negative "capture" is meaningless.
			for (let i = 0; i < Math.max(0, INITIAL[role] - have[role]); i++) out.push(role);
		}
		return out;
	};

	const extra = (have: Counts): number =>
		ORDER.reduce((n, role) => n + Math.max(0, have[role] - INITIAL[role]), 0);

	let balance = 0;
	for (const role of ORDER) balance += VALUE[role] * (ours[role] - theirs[role]);

	return {
		weTook: missing(theirs),
		theyTook: missing(ours),
		balance,
		promotions: { ours: extra(ours), theirs: extra(theirs) },
	};
}

/** Our material minus theirs, in pawns. */
export function materialBalance(fen: string, ourColour: Colour): number {
	return materialReport(fen, ourColour).balance;
}

/**
 * Plain words for a material edge.
 *
 * Named rather than left as a number: "+3" is a quantity, "a piece up" is the
 * thing you are meant to recognise over the board.
 */
export function describeBalance(balance: number): string {
	const n = Math.abs(balance);
	const what =
		n === 0
			? 'level'
			: n >= 9
				? 'a queen'
				: n >= 5
					? 'a rook'
					: n >= 3
						? 'a piece'
						: n === 2
							? 'two pawns'
							: 'a pawn';
	if (n === 0) return 'Material level';
	return balance > 0 ? `You are ${what} up` : `You are ${what} down`;
}
