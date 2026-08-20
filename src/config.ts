// Resolved configuration — see SPEC.md §11.

export type Speed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

export const CONFIG = {
	user: {
		lichess: 'VilhelmC',
		chesscom: 'VilhelmC',
	},

	explorer: {
		// Rating band lower-bounds accepted by the Lichess explorer.
		ratings: [1000, 1200, 1400] as number[],
		// Bullet excluded on purpose: premove-driven distributions do not
		// reflect the moves a rapid opponent will actually choose. SPEC.md §2.
		speeds: ['blitz', 'rapid'] as Speed[],
	},

	transfer: {
		// Transfer rate is only meaningful where you had time to recall prep.
		countedSpeeds: ['rapid', 'classical'] as Speed[],
	},

	repertoires: [
		{ id: 'italian', colour: 'w', line: '1. e4 e5 2. Nf3 Nc6 3. Bc4', active: true },
		{ id: 'scotch', colour: 'w', line: '1. e4 e5 2. Nf3 Nc6 3. d4', active: false },
	] as const,

	coach: {
		sessionMinutes: 20,
		maxNewNodesPerSession: 1,
	},

	engine: {
		// Files copied into public/engine by scripts/copy-engine.mjs.
		// Relative, WITHOUT a leading slash: the app is not always served from
		// the origin root, and a root-absolute path here 404s under /Schackal/.
		// Resolved through assetUrl() at the point of use — see src/base.ts.
		workerPath: 'engine/stockfish-18-lite-single.js',
		hashMb: 64,
		multiPvClassify: 1,
		multiPvSolution: 3,
		multiPvResistance: 4,
	},
} as const;
