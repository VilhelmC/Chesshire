// Core domain types — see SPEC.md §3.

/** Normalised FEN (board + side + castling + ep), without move counters. */
export type PositionKey = string;

export type Colour = 'w' | 'b';

export type MoveClass =
	| 'book'
	| 'blunder'
	| 'inaccuracy'
	| 'playable'
	| 'refutes_us';

export type Motif =
	| 'fork'
	| 'pin'
	| 'skewer'
	| 'discovered_attack'
	| 'double_attack'
	| 'hanging_piece'
	| 'back_rank'
	| 'trapped_piece'
	| 'overloaded_defender'
	| 'development_lead'
	| 'king_exposure'
	| 'space_grab'
	| 'pawn_win';

export type OpponentMove = {
	uci: string;
	san: string;
	/** Share of games played at this node within the configured band, 0..1. */
	frequency: number;
	gameCount: number;
	/** Empirical (wins + draws/2) for the side making this move. */
	scoreForOpponent: number;
	/** Centipawns from OUR point of view. */
	evalBefore: number;
	evalAfter: number;
	delta: number;
	classification: MoveClass;
	childId: PositionKey;
};

export type RepertoireNode = {
	id: PositionKey;
	repertoireId: string;
	fen: string;
	sideToMove: Colour;
	isOurTurn: boolean;
	/** Set when isOurTurn — the move we intend to play. */
	bookMove?: { uci: string; san: string; comment?: string };
	/** Set when !isOurTurn — everything the opponent might do. */
	opponentMoves: OpponentMove[];
	/** Probability of reaching this node in a real game given our repertoire. */
	reachProbability: number;
	/** Total games seen at this node in the explorer, for sparsity checks. */
	gameCount: number;
	depth: number;
	parentId: PositionKey | null;
};

export type SolutionTree = {
	/** Acceptable moves for us here, best first. */
	ourMoves: { uci: string; san: string; cpLoss: number }[];
	/** Plausible opponent replies -> continuation. null = line ends here. */
	replies: Record<string, SolutionTree | null>;
};

export type DrillKind = 'memorize' | 'punish' | 'pressure' | 'coverage';

export type DrillTarget =
	| { type: 'reach_eval'; cp: number }
	| { type: 'play_line'; plies: number };

export type Drill = {
	id: string;
	repertoireId: string;
	kind: DrillKind;
	rootFen: string;
	/** The opponent move that created this drill. */
	triggerMove?: { uci: string; san: string; frequency: number };
	solution: SolutionTree;
	target: DrillTarget;
	motifs: Motif[];
	/** reachProbability * frequency — scheduling priority. */
	frequencyWeight: number;
	sourceNodeId: PositionKey;
};

export type Attempt = {
	id: string;
	ts: number;
	mode: DrillKind | 'spar';
	drillId: string;
	sourceNodeId: PositionKey;
	fen: string;
	userMove: string;
	expected: string[];
	correct: boolean;
	cpLoss: number;
	latencyMs: number;
	motifs: Motif[];
	hintsUsed: number;
	roleReversalDone: boolean;
	sessionId: string;
};

/** One row of the Lichess opening explorer response. */
export type ExplorerMove = {
	uci: string;
	san: string;
	white: number;
	draws: number;
	black: number;
	averageRating?: number;
	/** Present in the live response; unused so far but modelled so it isn't lost. */
	opening?: { eco: string; name: string } | null;
	game?: unknown;
};

export type ExplorerResponse = {
	white: number;
	draws: number;
	black: number;
	moves: ExplorerMove[];
	opening?: { eco: string; name: string } | null;
};
