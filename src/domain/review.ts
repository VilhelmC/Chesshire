// Game review.
//
// The classification is the familiar one — best / excellent / good / inaccuracy
// / mistake / blunder — because it is the vocabulary every chess site already
// uses and inventing a private one would cost the user a translation for no
// gain. The thresholds are centipawn loss against the engine's choice.

export type Quality = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const QUALITY_ORDER: Quality[] = [
	'best',
	'excellent',
	'good',
	'inaccuracy',
	'mistake',
	'blunder',
];

/**
 * Single hue, dark to light, then two status steps for the two categories that
 * are actually actionable. A move being "good" is not a warning, so it does not
 * get a warning colour; a blunder is, and it does.
 */
export const QUALITY_COLOUR: Record<Quality, string> = {
	best: '#0b6b3a',
	excellent: '#1d8a52',
	good: '#4aa877',
	inaccuracy: '#eda100',
	mistake: '#ec835a',
	blunder: '#d03b3b',
};

export const QUALITY_LABEL: Record<Quality, string> = {
	best: 'Best',
	excellent: 'Excellent',
	good: 'Good',
	inaccuracy: 'Inaccuracy',
	mistake: 'Mistake',
	blunder: 'Blunder',
};

export function classifyQuality(cpLoss: number): Quality {
	if (cpLoss <= 10) return 'best';
	if (cpLoss <= 30) return 'excellent';
	if (cpLoss <= 60) return 'good';
	if (cpLoss <= 120) return 'inaccuracy';
	if (cpLoss <= 250) return 'mistake';
	return 'blunder';
}

export type Distribution = Record<Quality, number>;

export function distribution(losses: number[]): Distribution {
	const d: Distribution = {
		best: 0,
		excellent: 0,
		good: 0,
		inaccuracy: 0,
		mistake: 0,
		blunder: 0,
	};
	for (const l of losses) d[classifyQuality(l)]++;
	return d;
}

/**
 * Accuracy as a single percentage.
 *
 * A decaying function of average centipawn loss rather than "share of best
 * moves": the latter reports 0% for a game of consistently second-best moves,
 * which is not what the game was.
 */
export function accuracyPercent(losses: number[]): number | null {
	if (!losses.length) return null;
	const acpl = losses.reduce((a, b) => a + Math.min(b, 600), 0) / losses.length;
	return Math.round(100 * Math.exp(-acpl / 130));
}

/** One line of commentary for a move, from what we already recorded. */
export function comment(opts: {
	quality: Quality;
	cpLoss: number;
	phase?: 'book' | 'punish' | 'freeplay';
	assisted?: boolean;
	best?: string;
}): string {
	if (opts.assisted) return 'Answered with help — not scored.';

	const where =
		opts.phase === 'book'
			? 'in the line'
			: opts.phase === 'punish'
				? 'punishing their mistake'
				: 'in free play';

	switch (opts.quality) {
		case 'best':
			return `Best move ${where}.`;
		case 'excellent':
			return `Fine ${where} — ${opts.cpLoss}cp behind${opts.best ? ` ${opts.best}` : ''}.`;
		case 'good':
			return `Playable, but ${opts.cpLoss}cp behind${opts.best ? ` ${opts.best}` : ''}.`;
		case 'inaccuracy':
			return `Inaccuracy — ${opts.cpLoss}cp${opts.best ? `; ${opts.best} was better` : ''}.`;
		case 'mistake':
			return `Mistake — ${opts.cpLoss}cp${opts.best ? `; ${opts.best} was the move` : ''}.`;
		case 'blunder':
			return `Blunder — ${opts.cpLoss}cp${opts.best ? `; ${opts.best} was the move` : ''}.`;
	}
}
