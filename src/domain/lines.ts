// LEGACY. Not what the trainer practises any more.
//
// These five lines used to BE the book. They were a scaffold, and the app has
// outgrown it: an opening is a tree that forks, not a list of strings that
// duplicate their shared prefix five times, and the explorer already holds the
// real thing. Practice is now driven by domain/book.ts, which reads what is
// actually played at a position and asks the engine what it is worth.
//
// What is left here serves two purposes only:
//
//   * naming runs and cards recorded before positions were tracked, so old
//     history still reads as something rather than as a row of IDs;
//   * seeding the drill-research tab, which walks a line deliberately.
//
// Nothing in the training loop reads this file. Do not add to it.

export type Line = {
	id: string;
	name: string;
	colour: 'w' | 'b';
	/** SAN, space separated. Move numbers optional. */
	moves: string;
	note?: string;
};

export const LINES: Line[] = [
	{
		id: 'italian-giuoco',
		name: 'Giuoco Piano',
		colour: 'w',
		moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Bd2 Bxd2+ 8. Nbxd2',
		note: 'The main line. Black meets 3.Bc4 with the natural developing move.',
	},
	{
		id: 'italian-pianissimo',
		name: 'Giuoco Pianissimo',
		colour: 'w',
		moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. O-O d6 6. c3 O-O 7. Re1',
		note: 'The slow build-up. Fewer forcing lines, more chances for the opponent to drift.',
	},
	{
		id: 'two-knights-friedliver',
		name: 'Two Knights — Fried Liver',
		colour: 'w',
		moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 7. Qf3+ Ke6 8. Nc3',
		note: '5...Nxd5 is the mistake most players at this level make. This is the punishment.',
	},
	{
		id: 'two-knights-main',
		name: 'Two Knights — 5...Na5',
		colour: 'w',
		moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Bb5+ c6 7. dxc6 bxc6 8. Be2 h6 9. Nf3 e4 10. Ne5',
		note: 'What a prepared opponent plays instead. Worth knowing so you are not surprised by it.',
	},
	{
		id: 'italian-hungarian',
		name: 'Hungarian Defence',
		colour: 'w',
		moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Be7 4. d4 exd4 5. Nxd4 Nf6 6. Nc3 O-O 7. O-O',
		note: 'Passive but common. Central space is the reward.',
	},
];

export function lineById(id: string): Line | undefined {
	return LINES.find((l) => l.id === id);
}
