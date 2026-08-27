// Put the ledger first and the old detector away.
//
// Will: "the UI contains a lot of the old detector analysis that hasn't been
// adapted or hidden in favour of the new calculation algorithm."
//
// Three things were still speaking for the depth search with no signposting.
// The ranking table now sits behind the same checkbox as the explanation, and
// Stockfish moves INTO the ledger panel first — the engine number belongs next
// to the number you are checking it against, not inside the table being retired.
import { readFileSync, writeFileSync } from 'node:fs';
const need = (s, t, what) => { if (!s.includes(t)) { console.error('ANCHOR MISSING:', what); process.exit(1); } };

// ---- 1. LedgerPanel gains the Stockfish column -----------------------------
{
	const p = 'src/components/LedgerPanel.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('engine')) console.log('LedgerPanel already has the engine column');
	else {
		need(s, '\tplayed,\n\tplyKey,\n}: {', 'LedgerPanel props');
		s = s.replace('\tplayed,\n\tplyKey,\n}: {', '\tplayed,\n\tplyKey,\n\tengine,\n}: {');
		s = s.replace(
			'\t/** Identifies the position, so a late result cannot land under a new board. */\n\tplyKey: string;\n}) {',
			`	/** Identifies the position, so a late result cannot land under a new board. */
	plyKey: string;
	/**
	 * Stockfish, for comparison, in its own clearly-labelled column.
	 *
	 * It lives here rather than in the retired ranking table because the whole
	 * point of the number is to be read BESIDE the one being checked. Nothing in
	 * this component consults it — it is displayed and never computed with.
	 */
	engine?: { uci: string; cp: number }[] | null;
}) {`,
		);
		need(s, "\t\t\t\t\t\t<th style={{ ...th, textAlign: 'right' }}>total</th>", 'total header');
		s = s.replace(
			"\t\t\t\t\t\t<th style={{ ...th, textAlign: 'right' }}>total</th>",
			`						<th style={{ ...th, textAlign: 'right' }}>total</th>
						{engine && (
							<th style={{ ...th, textAlign: 'right' }} title="Stockfish. Shown for comparison; nothing here is computed from it.">
								Stockfish
							</th>
						)}`,
		);
		// A blank cell would read as "zero" or as "the engine agrees". Neither is true.
		const cell = `<td style={{ ...td, fontFamily: mono, textAlign: 'right' }}>{pawns(r.value)}</td>`;
		need(s, cell, 'value cell');
		s = s.replace(
			cell,
			`${cell}
								{engine && (
									<td style={{ ...td, fontFamily: mono, textAlign: 'right', color: color.ink2 }}>
										{engineFor(engine, uciOf(r.move))}
									</td>
								)}`,
		);
		s = s.replace(
			'/** Bare pawns, for a column that has to add up.',
			`/** Stockfish's number, or a word saying it did not look at this move. */
const engineFor = (rows: { uci: string; cp: number }[], move: string): string => {
	const hit = rows.find((c) => c.uci === move);
	if (!hit) return 'unrated';
	if (Math.abs(hit.cp) >= 9000) return hit.cp > 0 ? 'mate' : 'mated';
	return \`\${hit.cp > 0 ? '+' : ''}\${(hit.cp / 100).toFixed(2)}\`;
};

/** Bare pawns, for a column that has to add up.`,
		);
		writeFileSync(p, s);
		console.log('LedgerPanel.tsx: Stockfish column');
	}
}

// ---- 2. Lab: pass the engine, gate the table and the legend ----------------
{
	const p = 'src/views/Lab.tsx';
	let s = readFileSync(p, 'utf8');
	if (s.includes('engine={engineRows}')) { console.log('Lab already tidied'); process.exit(0); }
	const was = s.length;

	s = s.replace(
		'<LedgerPanel pos={step.pos} played={step.played} plyKey={key} />',
		'<LedgerPanel pos={step.pos} played={step.played} plyKey={key} engine={engineRows} />',
	);

	// The old ranking table, behind the same checkbox as its explanation.
	need(s, '\t\t\t\t\t\t\t\t<table\n\t\t\t\t\t\t\t\t\tdata-ply-detail={plyOf(at)}', 'ranking table open');
	s = s.replace(
		'\t\t\t\t\t\t\t\t<table\n\t\t\t\t\t\t\t\t\tdata-ply-detail={plyOf(at)}',
		'\t\t\t\t\t\t\t\t{showOld && (\n\t\t\t\t\t\t\t\t<table\n\t\t\t\t\t\t\t\t\tdata-ply-detail={plyOf(at)}',
	);
	need(s, '\t\t\t\t\t\t\t\t\t</tbody>\n\t\t\t\t\t\t\t\t</table>\n\n\t\t\t\t\t\t\t\t{step && at > 0 && (', 'ranking table close');
	s = s.replace(
		'\t\t\t\t\t\t\t\t\t</tbody>\n\t\t\t\t\t\t\t\t</table>\n\n\t\t\t\t\t\t\t\t{step && at > 0 && (',
		'\t\t\t\t\t\t\t\t\t</tbody>\n\t\t\t\t\t\t\t\t</table>\n\t\t\t\t\t\t\t\t)}\n\n\t\t\t\t\t\t\t\t{step && at > 0 && (',
	);

	// The legend outlived the thing it explained: the amber underline is the OLD
	// detector's verdict and is muted unless asked for, but its key stayed on
	// screen either way. "The blunder" is the puzzle's own and stays.
	need(s, '\t\t\t\t\t\t\t\t<span>\n\t\t\t\t\t\t\t\t\t<span style={{ borderBottom: `2px solid ${color.warn}` }}>', 'legend');
	s = s.replace(
		'\t\t\t\t\t\t\t\t<span>\n\t\t\t\t\t\t\t\t\t<span style={{ borderBottom: `2px solid ${color.warn}` }}>\n\t\t\t\t\t\t\t\t\t\tthe detector got this one wrong\n\t\t\t\t\t\t\t\t\t</span>\n\t\t\t\t\t\t\t\t</span>\n\t\t\t\t\t\t\t\t{steps.some((x) => x.detectorText) && (',
		'\t\t\t\t\t\t\t\t{showOld && (\n\t\t\t\t\t\t\t\t<span>\n\t\t\t\t\t\t\t\t\t<span style={{ borderBottom: `2px solid ${color.warn}` }}>\n\t\t\t\t\t\t\t\t\t\tthe detector got this one wrong\n\t\t\t\t\t\t\t\t\t</span>\n\t\t\t\t\t\t\t\t</span>\n\t\t\t\t\t\t\t\t)}\n\t\t\t\t\t\t\t\t{showOld && steps.some((x) => x.detectorText) && (',
	);

	writeFileSync(p, s);
	console.log(`Lab.tsx: engine into the ledger, old table and legend gated (+${s.length - was} chars)`);
}

// ---- 3. lab-check drives the UI into the state it checks --------------------
{
	const p = 'scripts/lab-check.mjs';
	let s = readFileSync(p, 'utf8');
	if (s.includes('old depth search')) console.log('lab-check already ticks the box');
	else {
		need(s, "await p.getByRole('button', { name: 'Lab', exact: true }).click();", 'lab-check entry');
		s = s.replace(
			"await p.getByRole('button', { name: 'Lab', exact: true }).click();",
			`await p.getByRole('button', { name: 'Lab', exact: true }).click();
// Most of what this file asserts is the OLD depth search's output, which is now
// off by default. A check that silently stopped finding its subject would go
// green forever, so it turns the thing on rather than being quietly retired.
await p.waitForTimeout(300);
await p.getByText('old depth search').click().catch(() => {});`,
		);
		writeFileSync(p, s);
		console.log('lab-check.mjs: ticks the old-detector box');
	}
}
