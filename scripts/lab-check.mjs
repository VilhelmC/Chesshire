// Does the Lab actually show the working — including the failures?
//
// ---------------------------------------------------------------------------
// The point of the Lab is that a claim about the detector's residue can be
// checked rather than taken on trust. So this check is not "does it render": it
// steps through a puzzle it solves and one it FAILS, reads the tables off the
// page, and asserts the things that would make the screen dishonest —
//   * a failed puzzle whose ranking table omits the move that was actually
//     played (a table that hides the right answer is worse than no table),
//   * a bare coordinate pair anywhere on the page (moves carry a glyph),
//   * a ply that takes so long to annotate the tab reads as broken.
//
// Run: node scripts/lab-check.mjs   (needs a built dist)
// ---------------------------------------------------------------------------

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4327', '--strictPort'], {
	stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });

const fail = [];
const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
p.on('console', (m) => {
	if (m.type() === 'error' && !/ERR_TUNNEL/.test(m.text())) fail.push(`console: ${m.text()}`);
});
// An exception thrown while a module is being evaluated is NOT a console
// message, so the listener above never saw `process is not defined` — the view
// went white and this check said OK. Uncaught errors arrive here instead.
p.on('pageerror', (e) => fail.push(`uncaught: ${e.message}`));
await p.goto('http://localhost:4327/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Lab', exact: true }).click();
// Most of what this file asserts is the OLD depth search's output, which is now
// off by default. A check that silently stopped finding its subject would go
// green forever, so it turns the thing on rather than being quietly retired.
await p.waitForTimeout(300);
await p.getByText('old depth search').click().catch(() => {});
await p.waitForTimeout(500);

const counts = await p.evaluate(() => document.body.innerText.match(/\d+ in this filter[^\n]*/)?.[0] ?? '');
console.log('filter line:', counts);
if (!/\d+ in this filter/.test(counts)) fail.push('no filter summary rendered');

/** Read the current ply: verdict text and the ranking table. */
const read = () =>
	p.evaluate(() => {
		const table = document.querySelector('table');
		const wrap = document.querySelector('.cg-wrap');
		return {
			body: document.body.innerText,
			table: table ? table.innerText.replace(/\n/g, ' | ') : null,
			orientation: wrap?.classList.contains('orientation-black') ? 'black' : 'white',
			// Arrow colours, so the check can tell which move is being drawn loudest.
			shapes: document.querySelector('.cg-shapes')?.innerHTML ?? '',
			// chessground's board is the custom element <cg-board>, not a .cg-board
			// class — a selector that reads right and matches nothing.
			lastMove: document.querySelectorAll('square.last-move').length,
		};
	});

/** Click through every ply chip, timing each. */
async function walk(label) {
	// The solution list IS the navigation, so the plies are addressed by index
	// rather than by their text — the text is a move, and moves repeat.
	// The solution is Train's move list now, so the plies are addressed the way
	// that component addresses them.
	const chips = await p.evaluate(() =>
		[...document.querySelectorAll('[data-ply]')].map((b) => b.getAttribute('data-ply')),
	);
	console.log(`\n=== ${label} — ${chips.length} plies: ${chips.join(' ')}`);
	const verdicts = [];
	const orientations = [];
	for (const c of chips) {
		const t0 = Date.now();
		await p.locator(`[data-ply="${c}"]`).first().click();
		// The ply is scored after a paint, so the check waits for the result rather
		// than for a fixed interval — the fixed interval was how a two-second hang
		// went unnoticed.
		if (c !== chips[0]) {
			// The table carries the ply it was computed for, so this cannot latch
			// onto the PREVIOUS ply's ranking still on screen — which is exactly the
			// stale frame this check caught the first time it ran.
			await p
				.locator(`table[data-ply-detail="${c}"]`)
				.waitFor({ state: 'visible', timeout: 8000 })
				.catch(() => fail.push(`${label} ply ${c}: no ranking within 8s`));
		}
		const ms = Date.now() - t0;
		const { body, table, orientation, lastMove, shapes } = await read();
		orientations.push(orientation);
		// Every ply after the first must show what was just played, or the board
		// changes without saying why.
		if (c !== chips[0] && lastMove < 2) fail.push(`${label} ply ${c}: no last-move highlight`);
		const verdict = /Found it|No opinion|Missed it|Not counted/.exec(body)?.[0] ?? 'blunder';
		verdicts.push(verdict);
		console.log(`  ply ${c.padEnd(8)} ${String(ms).padStart(5)}ms  ${verdict}`);
		if (table) console.log(`      ${table}`);

		// The puzzle's move must appear in the ranking, hit or miss.
		if (verdict !== 'blunder' && table && !/the puzzle's move/.test(table)) {
			fail.push(`${label} ply ${c}: ranking omits the puzzle's move`);
		}
		// Changing ply must not lock the tab up. One ply is about 200ms; a whole
		// chain at once used to be seconds, which is the bug this guards.
		// A guard against the tab appearing frozen, not a performance target: the
		// threat extension and the mate scan both make some positions genuinely
		// slower, and that is a trade already measured and accepted.
		// The panel shows a working state while this runs, so a slow ply is slow
		// rather than frozen — but past about five seconds that distinction stops
		// mattering to whoever is looking at it. The real fix is a worker; until
		// then this is the line between "thinking" and "broken".
		if (ms > 5000) fail.push(`${label} ply ${c}: ${ms}ms to annotate`);

		// The puzzle's move is the answer and must be the loudest thing on the
		// board; the detector's mistaken choice must be RED. It used to be drawn in
		// the heaviest green on the quality ramp — louder than the right move, and
		// saying "best" about it into the bargain.
		if (verdict !== 'blunder') {
			if (!/#0b6b3a/.test(shapes)) fail.push(`${label} ply ${c}: the puzzle's move is not the strong arrow`);
			if (verdict === 'Missed it' && !/#882020/.test(shapes)) {
				fail.push(`${label} ply ${c}: a missed ply drew no red arrow`);
			}
		}
	}
	// No bare coordinate pairs: every move carries a piece glyph.
	const { body } = await read();
	const bare = body.match(/(^|[\s—(])[a-h][1-8][–x×-][a-h][1-8]/g);
	if (bare) fail.push(`${label}: bare coordinate moves ${JSON.stringify(bare.slice(0, 3))}`);

	// A puzzle is one side's problem throughout. The board must not spin.
	if (new Set(orientations).size !== 1) {
		fail.push(`${label}: board rotated mid-chain ${JSON.stringify(orientations)}`);
	}
	// And it must be the solver's side — the one answering the blunder.
	const solverIs = /(White|Black) to move — this is the solver/.exec(body);
	if (solverIs && orientations[0] !== solverIs[1].toLowerCase()) {
		fail.push(`${label}: solver is ${solverIs[1]} but board shows ${orientations[0]}`);
	}
	console.log(`  orientation: ${orientations[0]}`);
	return verdicts;
}

/**
 * Change the filter, and time it.
 *
 * Will: "when I change the Show selector option, the page hangs." It did — the
 * whole chain was scored synchronously on selection, which on a twelve-ply
 * puzzle is seconds of frozen main thread. The fix is to score one ply on
 * demand, and this is the assertion that keeps it fixed.
 */
async function choose(value) {
	const t0 = Date.now();
	await p.selectOption('select >> nth=1', value);
	await p.locator('[data-ply]').first().waitFor({ state: 'visible', timeout: 8000 });
	const ms = Date.now() - t0;
	console.log(`\nfilter -> ${value}: ${ms}ms`);
	if (ms > 1500) fail.push(`switching the filter to ${value} took ${ms}ms`);
	return !(await p.evaluate(() => /Nothing matches/.test(document.body.innerText)));
}

// One it solves.
await choose('sharp');
const sharpV = await walk('sharp');
// That is what "sharp" means: no ply passed only by a tie, and none was missed.
if (sharpV.some((v) => v === 'No opinion' || v === 'Missed it')) {
	fail.push(`a "sharp" puzzle contained ${JSON.stringify(sharpV)}`);
}

// One that passes only by a tie: the honest middle case must be reachable.
if (!(await choose('tied'))) fail.push('no tie-only puzzles browsable');
else await walk('tied');

// One it fails — the reason this screen exists.
if (!(await choose('failed'))) fail.push('no failing puzzles browsable');
else await walk('failed');

// The argument: the chain's structure, not just its number. This is the thing
// the whole coercion search exists to produce, so the check makes sure it is on
// the screen and says something about what the opponent still has.
{
	const arg = await p
		.locator('h4', { hasText: 'Explanation' })
		.first()
		.waitFor({ state: 'visible', timeout: 12000 })
		.then(() => true)
		.catch(() => false);
	if (!arg) fail.push('no explanation shown');
	else {
		const story = await p.evaluate(() => {
			const h = [...document.querySelectorAll('h4')].find((x) => x.textContent === 'Explanation');
			const box = h?.parentElement;
			return [...(box?.querySelectorAll('p') ?? [])].map((n) => n.textContent ?? '');
		});
		console.log(`\nexplanation:\n  ${story.join('\n  ')}`);
		// Prose, not a tree: it has to say what the move does and where it lands.
		if (story.length < 2) fail.push('the explanation is not written out');
		if (!story.some((l) => /wins|takes nothing/.test(l))) {
			fail.push('the explanation never says what the move takes');
		}
		if (!story.some((l) => /settles at/.test(l))) fail.push('the explanation never says where it settles');
		// A number in the prose has to name who is ahead, not just a sign.
		if (story.some((l) => /-\d/.test(l))) fail.push('a raw negative number leaked into the prose');

		// Any row can be asked about, and asking changes the subject.
		const before = story.join(' ');
		const rows = await p.locator('tbody tr').count();
		if (rows > 1) {
			await p.locator('tbody tr').nth(1).click();
			await p.waitForTimeout(1200);
			const after = await p.evaluate(() => {
				const h = [...document.querySelectorAll('h4')].find((x) => x.textContent === 'Explanation');
				return [...(h?.parentElement?.querySelectorAll('p') ?? [])].map((n) => n.textContent).join(' ');
			});
			if (after === before) fail.push('asking about another row explained the same move');
			else console.log(`  (asking about row 2 changed the explanation)`);
		}
	}
}

// The board is the same size here as everywhere else, and the move list shows
// whole moves in colour rather than clipped ones in grey.
{
	const board = await p.evaluate(() => {
		const el = document.querySelector('.cg-wrap');
		return el ? Math.round(el.getBoundingClientRect().width) : 0;
	});
	// Compared against the app's own rule rather than against Train's board:
	// Train shows no board until a run is started, so that comparison measured
	// nothing and reported 0px.
	console.log(`\nboard: ${board}px`);
	if (board < 420) fail.push(`the Lab board is ${board}px — smaller than the app's minimum`);

	const moves = await p.evaluate(() =>
		[...document.querySelectorAll('[data-ply]')].map((b) => ({
			text: b.innerText.trim(),
			// A cell whose text is wider than the cell is being clipped.
			clipped: b.scrollWidth > b.clientWidth + 1,
			colour: getComputedStyle(b).color,
			title: b.getAttribute('title') ?? '',
		})),
	);
	const clipped = moves.filter((m) => m.clipped);
	console.log(`moves: ${moves.length}, clipped ${clipped.length}, colours ${new Set(moves.map((m) => m.colour)).size}`);
	if (clipped.length) fail.push(`${clipped.length} move cells are clipped: ${clipped.map((c) => c.text).join(' ')}`);
	if (moves.some((m) => !m.title)) fail.push('a move has no hover text');
	if (new Set(moves.map((m) => m.colour)).size < 2) {
		fail.push('every move is the same colour — the verdict is not readable');
	}
}

// The notes panel, and the file link.
//
// Chromium has the File System Access API, so the button must offer to link a
// file rather than to download one — and the picker itself cannot be driven from
// here, so what is checked is the state machine around it: the box saves, the
// count goes up, and the button says the right thing for this browser.
{
	const box = p.locator('textarea');
	await box.waitFor({ state: 'visible', timeout: 5000 }).catch(() => fail.push('no notes box'));
	if (await box.count()) {
		await box.fill('checked by lab-check');
		// Notes commit on blur: it is prose, not a form.
		await p.locator('h3').first().click();
		await p.waitForTimeout(300);
		const label = await p.locator('button', { hasText: /Link a file|Save now|Download|Grant access/ }).first().innerText();
		console.log(`\nnotes button: ${label.trim()}`);
		const supported = await p.evaluate(() => typeof window.showSaveFilePicker === 'function');
		if (supported && !/Link a file|Save now|Grant access/.test(label)) {
			fail.push(`file picker exists but the button says "${label.trim()}"`);
		}
		if (!supported && !/Download/.test(label)) {
			fail.push(`no file picker, but the button says "${label.trim()}"`);
		}
		// And the note has to survive a reload, or the panel is a scratchpad.
		//
		// The reload picks a RANDOM puzzle, so the note has to be looked for on the
		// one it was written on — the first version of this check reloaded, landed
		// somewhere else, saw no note and called it lost.
		const id = await p.evaluate(() => document.querySelector('h3 a')?.textContent ?? '');
		await p.reload({ waitUntil: 'networkidle' });
		await p.getByRole('button', { name: 'Lab', exact: true }).click();
		await p.waitForTimeout(400);
		await p.locator('input[placeholder="puzzle id"]').fill(id);
		await p.getByRole('button', { name: 'Open', exact: true }).click();
		await p.waitForTimeout(800);
		const kept = await p.evaluate(() => document.body.innerText.match(/This puzzle has \d+ note/)?.[0] ?? '');
		console.log(`after reload: ${kept || 'NOTE LOST'}`);
		if (!kept) fail.push('a note did not survive a reload');
	}
}

// The Stockfish column: asked for, labelled, and belonging to this ply.
//
// It is the one place on the screen where an outside authority's numbers appear,
// so the check makes sure they arrive under their own heading rather than
// blending into the detector's.
{
	// The notes check left the page reloaded and sitting on the blunder, where
	// there is no ranking at all — so step onto a scored ply before asking for a
	// column of it.
	const plies = await p.evaluate(() =>
		[...document.querySelectorAll('[data-ply]')].map((b) => b.getAttribute('data-ply')),
	);
	if (plies.length > 1) {
		await p.locator(`[data-ply="${plies[1]}"]`).first().click();
		await p.locator('table').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
	}
	await p.locator('input[type="checkbox"]').check();
	const header = await p
		.locator('th', { hasText: 'Stockfish' })
		.waitFor({ state: 'visible', timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	if (!header) fail.push('the Stockfish column did not appear when asked for');
	else {
		// The engine runs in a worker; give it room, and report rather than fail if
		// this environment cannot start it.
		const filled = await p
			.waitForFunction(
				() => {
					const t = document.querySelector('table');
					return !!t && !/…/.test(t.innerText);
				},
				{ timeout: 20000 },
			)
			.then(() => true)
			.catch(() => false);
		const row = await p.evaluate(() => document.querySelector('table')?.innerText.split('\n')[2] ?? '');
		console.log(`\nengine column ${filled ? 'filled' : 'STILL EMPTY'}: ${row.replace(/\t/g, ' | ')}`);
		if (!filled) console.log('  (engine may be unavailable in this environment — not treated as a failure)');
	}
	await p.locator('input[type="checkbox"]').uncheck();
}

// Play from here: the board must accept a move that is not the puzzle's.
{
	await p.locator('button[title*="Play on"]').click();
	const before = await p.evaluate(() => document.querySelectorAll('piece').length);
	// Drag the first legal-looking piece is fragile; instead check the mode is on
	// and that the annotation still says it belongs to the puzzle position.
	const note = await p.evaluate(() => /Playing on/.test(document.body.innerText));
	if (!note) fail.push('play-from-here did not turn on');
	if (!before) fail.push('board lost its pieces in play mode');
	await p.locator('button[title*="Stop playing"]').click();
}

// And the shuffle keeps working.
await p.getByRole('button', { name: 'Another position' }).click();
await p.waitForTimeout(800);
const after = await p.evaluate(() => document.querySelector('h3')?.innerText ?? '');
console.log('\nafter shuffle:', after.replace(/\n/g, ' '));
if (!after) fail.push('shuffle produced an empty position');

await b.close();
srv.kill();

console.log('\n' + (fail.length ? `FAIL\n  ${fail.join('\n  ')}` : 'OK'));
process.exit(fail.length ? 1 : 0);
