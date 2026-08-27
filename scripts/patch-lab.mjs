// Add the ledger's failure buckets to the Lab's filter.
//
// The existing options filter on `sharp`/`firm`/`clean` in labPuzzles.json,
// which are the OLD DEPTH SEARCH's opinion. Selecting "failed" there gets you
// that search's failures, not the ledger's — so the categories we are now
// working against were unbrowsable. These four are the ledger's, keyed by
// puzzle and solver ply, from scripts/ledger-measure.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/views/Lab.tsx';
let s = readFileSync(p, 'utf8');
const was = s.length;

if (s.includes('ledgerBuckets')) { console.log('already patched'); process.exit(0); }

s = s.replace(
	"type Only = 'any' | 'sharp' | 'coerced' | 'tied' | 'failed';",
	`type Only =
	| 'any'
	| 'sharp'
	| 'coerced'
	| 'tied'
	| 'failed'
	// The ledger's buckets (DEFICIENCY.md), per solver ply. These are what the
	// current work is against; the five above are the depth search's verdict and
	// are kept only until it is deleted.
	| 'blind'
	| 'unresolved'
	| 'deadline'
	| 'wrong';

/** puzzle id -> ply -> bucket, for every ply the ledger does NOT get sole-top. */
const BUCKETS = LEDGER as Record<string, Record<string, string>>;
const anyPly = (id: string, bucket: string) =>
	Object.values(BUCKETS[id] ?? {}).some((b) => b === bucket);`,
);

s = s.replace(
	`	failed: (p) => !p.clean,
};`,
	`	failed: (p) => !p.clean,
	blind: (p) => anyPly(p.id, 'blind'),
	unresolved: (p) => anyPly(p.id, 'unresolved'),
	deadline: (p) => anyPly(p.id, 'deadline'),
	wrong: (p) => anyPly(p.id, 'wrong'),
};`,
);

s = s.replace(
	`						<option value="failed">failed — it preferred another move</option>`,
	`						<option value="failed">failed — it preferred another move</option>
						<optgroup label="ledger (τ = 1)">
							<option value="wrong">wrong preference — it had an opinion and it was wrong</option>
							<option value="unresolved">no resolution — it saw something, could not choose</option>
							<option value="blind">saw nothing — every move scored zero</option>
							<option value="deadline">needs a deadline — the answer scored zero</option>
						</optgroup>`,
);

// The import goes after the last existing data import so relative paths stay together.
s = s.replace(
	"import PUZZLES from '../data/labPuzzles.json';",
	"import PUZZLES from '../data/labPuzzles.json';\nimport LEDGER from '../data/ledgerBuckets.json';",
);

writeFileSync(p, s);
console.log(`patched Lab.tsx (+${s.length - was} chars)`);
