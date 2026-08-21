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

await p.getByRole('button', { name: 'The same pin, no queen behind' }).click();
await p.waitForTimeout(300);
console.log('\n--- preset 2 (no queen behind)');
console.log(JSON.stringify(await read(), null, 1));

await p.getByRole('button', { name: 'The pin — worth a tempo' }).click();
await p.waitForTimeout(200);
// click k=1 row
await p.evaluate(() => { const rows=[...document.querySelectorAll('tbody tr')]; rows[1]?.click(); });
await p.waitForTimeout(200);
await p.screenshot({ path: 'lab.png', fullPage: false });

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
