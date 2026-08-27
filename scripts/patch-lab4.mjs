// Get the old detector off the screen, and the engine on it.
//
// Will: "the UI contains a lot of the old detector analysis that hasn't been
// adapted or hidden in favour of the new calculation algorithm." Three places
// were showing the depth search's opinion beside the ledger's with no
// signposting, and the old one was louder:
//
//   * the move list coloured a ply RED that the ledger ranks 1 of 46,
//   * the Explanation argued a move neither the ledger nor the puzzle plays,
//   * the ranking table is entirely the old search's.
//
// All three now sit behind one checkbox, off by default. Nothing is deleted —
// the old detector is still the thing being replaced, and being able to put it
// back beside the new one is the point of the Lab.
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/views/Lab.tsx';
let s = readFileSync(p, 'utf8');
if (s.includes('showOld')) { console.log('already patched'); process.exit(0); }
const was = s.length;
const need = (t) => { if (!s.includes(t)) { console.error('ANCHOR MISSING:', t.slice(0, 60)); process.exit(1); } };

// 1. the toggle, next to the existing engine one
need('const [showEngine, setShowEngine] = useState(false);');
s = s.replace(
	'const [showEngine, setShowEngine] = useState(false);',
	`// On by default now. Will wants the reference alongside while troubleshooting
	// the ledger, and the original argument for hiding it — that an engine column
	// turns every position into a comparison with an authority — is about training,
	// not about a bench.
	const [showEngine, setShowEngine] = useState(true);
	/** The old depth search's ranking, explanation and move-list colours. */
	const [showOld, setShowOld] = useState(false);`,
);

// 2. the explanation
need('{argument && (');
s = s.replace('{argument && (', '{showOld && argument && (');

// 3. move-list colours: the old search's verdict, so mute them unless asked
need("				suboptimal: i > 0 && st.solver && st.verdict !== 'found' && st.verdict !== 'coerced',");
s = s.replace(
	"				suboptimal: i > 0 && st.solver && st.verdict !== 'found' && st.verdict !== 'coerced',",
	"				suboptimal:\n					showOld && i > 0 && st.solver && st.verdict !== 'found' && st.verdict !== 'coerced',",
);
need("				tone:\n					i === 0\n						? ('muted' as const)\n						: !st.solver");
s = s.replace(
	"				tone:\n					i === 0\n						? ('muted' as const)\n						: !st.solver",
	"				tone:\n					i === 0\n						? ('muted' as const)\n						: !showOld\n							? ('muted' as const)\n						: !st.solver",
);
// the memo now depends on it
s = s.replace('\t\t[steps, offset],\n\t);', '\t\t[steps, offset, showOld],\n\t);');

// 4. the checkbox, beside the Stockfish one
const box = 'Stockfish column';
need(box);
s = s.replace(
	new RegExp(`(<label[^>]*>\\s*<input[^>]*checked=\\{showEngine\\}[\\s\\S]{0,400}?${box}\\s*</label>)`),
	`$1
					<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
						<input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />{' '}
						old depth search
					</label>`,
);

writeFileSync(p, s);
console.log(`Lab.tsx old-detector toggle + engine default (+${s.length - was} chars)`);
