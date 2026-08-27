// Two fixes to the Lab, both in service of manual review.
//
// 1. The explanation was keyed by POSITION while the search that filled it
//    always argued `step.played`. Clicking a row in the ranking changed the
//    heading — "how the detector arrived at its score for ♕h5–d1" — above an
//    argument for a different move entirely. On a screen whose whole purpose is
//    to be checked, that is the worst possible bug, and it is live right now in
//    exactly the panel the wrong-preference review will be read from.
//
// 2. Tab, puzzle, ply and filters restored on reload. Annotating a bucket means
//    many reloads, and landing back at puzzle 1 ply 0 each time is most of the
//    friction.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/views/Lab.tsx';
let s = readFileSync(p, 'utf8');
const was = s.length;
let done = [];

// ---- 1. key the explanation by the move it is about --------------------
if (!s.includes('argKey')) {
	s = s.replace(
		"	const argument = why && why.key === key ? why.value : null;\n",
		'',
	);
	s = s.replace(
		"	const explained = asked ?? detectorMove ?? step?.played ?? null;",
		`	const explained = asked ?? detectorMove ?? step?.played ?? null;
	/**
	 * The explanation is keyed by the MOVE as well as the position.
	 *
	 * It was keyed by position alone while the search filling it always argued
	 * the puzzle's move, so asking about another row changed the heading and
	 * nothing else. Caught by scripts/lab-check.mjs, which clicks the second row
	 * and asserts the explanation changed.
	 */
	const argKey = \`\${key}:\${explained ?? ''}\`;
	const argument = why && why.key === argKey ? why.value : null;`,
	);
	s = s.replace(
		`		if (!step || at === 0 || !shown) return;
		let live = true;
		const t = setTimeout(() => {
			const value = explain(step.pos, toMove(step.played), 2, 15_000);
			if (live) setWhy({ key, value });
		}, 250);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [step, at, key, shown]);`,
		`		if (!step || at === 0 || !shown || !explained) return;
		let live = true;
		const t = setTimeout(() => {
			const value = explain(step.pos, toMove(explained), 2, 15_000);
			if (live) setWhy({ key: argKey, value });
		}, 250);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [step, at, argKey, explained, shown]);`,
	);
	done.push('explanation keyed by move');
}

// ---- 2. restore where you were ----------------------------------------
if (!s.includes('viewState')) {
	s = s.replace(
		"import LEDGER from '../data/ledgerBuckets.json';",
		"import LEDGER from '../data/ledgerBuckets.json';\nimport { recall, remember } from '../data/viewState';",
	);
	s = s.replace(
		`	const [theme, setTheme] = useState<string>('any');
	const [only, setOnly] = useState<Only>('any');
	const [id, setId] = useState<string | null>(null);
	const [ply, setPly] = useState(0);`,
		`	// Reopen where you left off. Each value is validated on the way out by a
	// predicate only this component knows: a theme has to still be a theme, a
	// puzzle has to still be in the set, and a ply has to be inside the chain —
	// which is checked below, once the chain exists.
	const [theme, setTheme] = useState<string>(
		() => recall('labTheme', (v) => v === 'any' || THEMES.includes(v)) ?? 'any',
	);
	const [only, setOnly] = useState<Only>(
		() => (recall('labOnly', (v) => v in KEEP) as Only | undefined) ?? 'any',
	);
	const [id, setId] = useState<string | null>(
		() => recall('labId', (v) => ALL.some((q) => q.id === v)) ?? null,
	);
	const [ply, setPly] = useState(() => recall('labPly', (v) => v >= 0) ?? 0);`,
	);
	s = s.replace(
		`	const at = Math.min(ply, Math.max(0, steps.length - 1));
	const step = steps[at];`,
		`	const at = Math.min(ply, Math.max(0, steps.length - 1));
	const step = steps[at];

	// Written back AFTER clamping, so a stored ply can never be past the end of a
	// shorter chain even once.
	useEffect(() => {
		if (puzzle) remember({ labId: puzzle.id, labPly: at, labTheme: theme, labOnly: only });
	}, [puzzle, at, theme, only]);`,
	);
	done.push('puzzle/ply/filter persistence');
}

writeFileSync(p, s);
console.log(`Lab.tsx ${done.join(' + ')} (+${s.length - was} chars)`);
