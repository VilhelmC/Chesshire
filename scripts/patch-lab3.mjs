// Put the ledger's panel on the Lab, above the depth search's explanation.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/views/Lab.tsx';
let s = readFileSync(p, 'utf8');
if (s.includes('LedgerPanel')) { console.log('already patched'); process.exit(0); }
const was = s.length;

s = s.replace(
	"import { recall, remember } from '../data/viewState';",
	"import { recall, remember } from '../data/viewState';\nimport { LedgerPanel } from '../components/LedgerPanel';",
);

// Anchor on the Explanation section, which appears once.
const anchor = '{argument && (';
if (!s.includes(anchor)) { console.error('ANCHOR NOT FOUND — nothing changed'); process.exit(1); }
s = s.replace(
	anchor,
	`{step && at > 0 && (
									<LedgerPanel pos={step.pos} played={step.played} plyKey={key} />
								)}

								${anchor}`,
);

writeFileSync(p, s);
console.log(`Lab.tsx + LedgerPanel (+${s.length - was} chars)`);
