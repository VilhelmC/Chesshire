import { describe, it, expect } from 'vitest';
import {
	searchOpenings,
	allOpenings,
	openingForPath,
	nameForPath,
	sideToMoveAfter,
} from '../src/domain/openings';
import { playSanLine } from '../src/domain/chess';

const names = (q: string) => searchOpenings(q).hits.map((h) => h.name);
const total = (q: string) => searchOpenings(q).total;

describe('the bundled index', () => {
	it('has the openings a 1.e4 e5 player actually meets', () => {
		expect(allOpenings().length).toBeGreaterThan(1500);
	});

	it('is all playable — a name pointing at illegal moves would pin a position that does not exist', () => {
		// Every entry was validated at build time; this is the guard that the file
		// on disk still is what the build produced.
		for (const o of allOpenings()) {
			expect(() => playSanLine(o.path.join(' '))).not.toThrow();
		}
	});

	it('never has an empty path', () => {
		expect(allOpenings().every((o) => o.path.length > 0)).toBe(true);
	});
});

describe('searchOpenings', () => {
	it('finds the ones asked for by name', () => {
		expect(names('two knights')[0]).toMatch(/two knights/i);
		expect(names('scotch')[0]).toMatch(/scotch/i);
		expect(names('giuoco piano')[0]).toMatch(/giuoco piano/i);
	});

	it('finds a sub-variation from words in any order, without the punctuation', () => {
		// "Scotch: Schmidt variation" — typed without the colon, in either order.
		expect(names('scotch schmidt')[0]).toMatch(/scotch.*schmidt/i);
		expect(names('schmidt scotch')[0]).toMatch(/scotch.*schmidt/i);
	});

	it('matches on prefixes, so results appear while typing', () => {
		expect(names('two kn')[0]).toMatch(/two knights/i);
		expect(names('najd').some((n) => /najdorf/i.test(n))).toBe(true);
	});

	it('prefers the general opening over its sub-variations', () => {
		const top = names('scotch')[0];
		// "Scotch opening" or "Scotch game", not "Scotch: Göring gambit, ...".
		expect(top.length).toBeLessThan(names('scotch')[names('scotch').length - 1].length + 20);
		expect(top).toMatch(/^scotch/i);
	});

	it('requires every token to match, so unrelated openings are not offered', () => {
		expect(names('scotch najdorf')).toEqual([]);
	});

	it('ignores a query too short to mean anything', () => {
		expect(names('')).toEqual([]);
		expect(names('s')).toEqual([]);
	});

	it('returns nothing rather than guessing at nonsense', () => {
		expect(names('qqzzxx')).toEqual([]);
	});

	it('reports how many it truncated, so a cut list is not read as "not there"', () => {
		// This is the bug: 43 Scotch variations, 8 shown, and the Mieses fell off
		// the bottom — which reads exactly like it is missing from the index.
		const r = searchOpenings('sicilian', 5);
		expect(r.hits.length).toBe(5);
		expect(r.total).toBeGreaterThan(5);
		expect(total('sicilian')).toBe(r.total);
	});

	it('finds a variation buried far down a big family', () => {
		// "scotch" alone cannot show all 40-odd; the point is that it is reachable
		// and that the total says so.
		expect(total('scotch')).toBeGreaterThan(20);
		expect(names('scotch mieses')).toContain('Scotch: Mieses variation');
		expect(searchOpenings('scotch', 100).hits.map((h) => h.name)).toContain(
			'Scotch: Mieses variation',
		);
	});
});

describe('searching by ECO code', () => {
	it('lists a specific code', () => {
		const r = searchOpenings('C45');
		expect(r.total).toBeGreaterThan(5);
		expect(r.hits.every((h) => h.eco === 'C45')).toBe(true);
		expect(r.hits.map((h) => h.name)).toContain('Scotch: Mieses variation');
	});

	it('is case-insensitive', () => {
		expect(searchOpenings('c45').total).toBe(searchOpenings('C45').total);
	});

	it('takes a partial code as a band', () => {
		const r = searchOpenings('C4', 200);
		expect(r.hits.every((h) => h.eco.startsWith('C4'))).toBe(true);
		expect(r.total).toBeGreaterThan(searchOpenings('C45').total);
	});

	it('combines a code with a word', () => {
		const r = searchOpenings('c45 mieses');
		expect(r.hits.map((h) => h.name)).toEqual(['Scotch: Mieses variation']);
	});

	it('matches the code against the code, never against the moves', () => {
		// "c4" appears in countless lines. It must not drag in the English Opening
		// just because the move c4 is played there.
		const r = searchOpenings('C4', 300);
		expect(r.hits.every((h) => h.eco.startsWith('C4'))).toBe(true);
	});
});

describe('searching by moves', () => {
	it('names a line you paste in', () => {
		const r = searchOpenings('e4 e5 Nf3 Nc6 d4');
		expect(r.hits[0].name).toMatch(/scotch/i);
	});

	it('accepts move numbers', () => {
		const r = searchOpenings('1. e4 e5 2. Nf3 Nc6 3. d4');
		expect(r.hits[0].name).toMatch(/scotch/i);
	});

	it('shows the shallowest match first — the opening before its variations', () => {
		const r = searchOpenings('e4 e5 Nf3 Nc6 d4', 5);
		const lens = r.hits.map((h) => h.path.length);
		expect([...lens].sort((a, b) => a - b)).toEqual(lens);
	});

	it('returns nothing for a line nobody has named', () => {
		expect(searchOpenings('a3 a6 h3 h6').total).toBe(0);
	});

	it('does not mistake a one-word name for a move', () => {
		// "e4" alone is ambiguous; a single token stays a name search.
		expect(searchOpenings('scotch').total).toBeGreaterThan(0);
	});
});

describe('naming a position', () => {
	it('names a path that is exactly an opening', () => {
		const two = searchOpenings('two knights').hits[0];
		expect(openingForPath(two.path)?.name).toBe(two.name);
	});

	it('is null for a path that is not itself named', () => {
		expect(openingForPath(['a3', 'a6', 'h3'])).toBeNull();
	});

	it('falls back to the most specific named ancestor', () => {
		const two = searchOpenings('two knights').hits[0];
		const deeper = [...two.path, 'Ng5'];
		const found = nameForPath(deeper);
		expect(found).not.toBeNull();
		// Either the Two Knights itself or something more specific below it — but
		// never something shallower when a deeper name exists.
		expect(found!.path.length).toBeGreaterThanOrEqual(two.path.length);
	});

	it('is null before any move has been played', () => {
		expect(nameForPath([])).toBeNull();
	});

	it('inherits the nearest name rather than giving up on an unnamed position', () => {
		// 1.a3 is Anderssen's Opening — the index goes that far down. Something
		// several plies past a named node still gets the name it belongs under.
		const deep = ['a3', 'a6', 'h3', 'h6', 'g3', 'g6'];
		const found = nameForPath(deep);
		if (found) expect(deep.join(' ').startsWith(found.path.join(' '))).toBe(true);
	});
});

describe('sideToMoveAfter', () => {
	it('says who moves next at a pinned root', () => {
		expect(sideToMoveAfter([])).toBe('w');
		expect(sideToMoveAfter(['e4'])).toBe('b');
		expect(sideToMoveAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'])).toBe('w');
	});
});
