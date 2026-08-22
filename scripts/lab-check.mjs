// Does the Lab show the working, and does the working come out right?
//
// Loads the two preset positions whose verdicts are known by hand — the pin and
// the same pin without the queen behind it — and prints every table. Both bugs
// this file found on its first run (the prize counted as its own defender; six
// tabs no longer crossing a phone) were invisible to the unit tests.
//
// Run: node scripts/lab-check.mjs   (needs a built dist)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4327', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });

// Tab bar width with six tabs.
for (const w of [360, 393]) {
	const p = await b.newPage({ viewport: { width: w, height: 800 } });
	await p.goto('http://localhost:4327/', { waitUntil: 'networkidle' });
	const m = await p.evaluate(() => {
		const nav = document.querySelector('nav');
		return { scroll: nav.scrollWidth, client: nav.clientWidth };
	});
	console.log('tabbar', w, JSON.stringify(m));
	await p.close();
}

const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await p.goto('http://localhost:4327/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Lab', exact: true }).click();
await p.waitForTimeout(300);

const read = async () => p.evaluate(() => {
	const tables = [...document.querySelectorAll('table')].map(t => t.innerText.replace(/\n/g, ' | '));
	const verdict = document.querySelector('h3')?.parentElement?.querySelectorAll('div')[0]?.innerText;
	return { verdict, tables };
});
console.log('\n--- preset 1 (pin)');
console.log(JSON.stringify(await read(), null, 1));

for (const name of [
	'#2 Rook must commit first',
	'#3 Neither side is in place',
	'#4 Nothing can defend it',
	'#5 No attacker within reach',
	'#6 A defender with a prior job',
	'#7 The knight is not pinned — it checks',
]) {
	await p.getByRole('button', { name }).click();
	await p.waitForTimeout(400);
	console.log('\n---', name);
	console.log(JSON.stringify(await read(), null, 1));
}

await p.getByRole('button', { name: '#1 Everything already in place' }).click();
await p.waitForTimeout(200);
// click k=1 row
await p.evaluate(() => { const rows=[...document.querySelectorAll('tbody tr')]; rows[1]?.click(); });
await p.waitForTimeout(200);
await p.screenshot({ path: 'lab.png', fullPage: false });

// Does the tray actually place a piece, and on the square it was dropped on?
// The click-to-place version this replaced was landing a square out, and no
// unit test can see that.
{
	const before = await p.inputValue('input[spellcheck="false"]');
	const box = await p.evaluate(() => {
		const wrap = document.querySelector('cg-board').getBoundingClientRect();
		const tray = [...document.querySelectorAll('.cg-wrap piece')]
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.top > wrap.bottom)[0];
		return {
			from: { x: tray.left + tray.width / 2, y: tray.top + tray.height / 2 },
			// a4: file a (0.5/8 across), rank 4 (4.5/8 down from the top)
			to: { x: wrap.left + wrap.width * (0.5 / 8), y: wrap.top + wrap.height * (4.5 / 8) },
		};
	});
	await p.mouse.move(box.from.x, box.from.y);
	await p.mouse.down();
	await p.mouse.move(box.to.x, box.to.y, { steps: 12 });
	await p.mouse.up();
	await p.waitForTimeout(400);
	const after = await p.inputValue('input[spellcheck="false"]');
	console.log('\ndrag a white pawn to a4:');
	console.log('  before', before.split(' ')[0]);
	console.log('  after ', after.split(' ')[0]);
}

// ...and does dragging a piece OFF the board remove it?
{
	const before = await p.inputValue('input[spellcheck="false"]');
	const box = await p.evaluate(() => {
		const wrap = document.querySelector('cg-board').getBoundingClientRect();
		return {
			from: { x: wrap.left + wrap.width * (0.5 / 8), y: wrap.top + wrap.height * (4.5 / 8) },
			off: { x: wrap.right + 160, y: wrap.top + wrap.height / 2 },
		};
	});
	await p.mouse.move(box.from.x, box.from.y);
	await p.mouse.down();
	await p.mouse.move(box.off.x, box.off.y, { steps: 12 });
	await p.mouse.up();
	await p.waitForTimeout(400);
	const after = await p.inputValue('input[spellcheck="false"]');
	console.log('\ndrag that pawn off the board:');
	console.log('  before', before.split(' ')[0]);
	console.log('  after ', after.split(' ')[0]);
}

// The one control that flips both the board and the side to move.
{
	await p.getByRole('button', { name: /to move/ }).click();
	await p.waitForTimeout(300);
	const state = await p.evaluate(() => ({
		fen: document.querySelector('input[spellcheck="false"]').value,
		orientation: document.querySelector('.cg-wrap').className,
		label: [...document.querySelectorAll('button')].find((b) => /to move/.test(b.textContent))
			.textContent,
	}));
	console.log('\nafter flipping:', state.label.trim(), '|', state.fen.split(' ')[1], '|', state.orientation);
}

// click a square on the board to check the select event works
const before = await p.evaluate(() => document.querySelector('h3').innerText);
await p.evaluate(() => {
	const sq = document.querySelector('cg-board');
	const r = sq.getBoundingClientRect();
	return { x: r.left + r.width * (3.5 / 8), y: r.top + r.height * (0.5 / 8) };
}).then(async ({ x, y }) => { await p.mouse.click(x, y); });
await p.waitForTimeout(300);
const after = await p.evaluate(() => document.querySelector('h3').innerText);
console.log('\nclick target: before =', before, '| after =', after);

await b.close();
srv.kill();
