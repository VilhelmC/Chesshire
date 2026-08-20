// Publish the built app to the `gh-pages` branch.
//
//   npm run deploy
//
// The Actions workflow does the same thing on push, but Actions minutes are
// metered and this is not. Nothing here needs a runner: the build already
// happens on your machine, and pushing a branch is the whole of "deploy" for a
// static app.
//
// The branch is written through a git WORKTREE rather than by checking it out.
// A checkout would swap your working tree to a branch containing nothing but
// built output, and any interruption at that point leaves you standing in it
// wondering where the source went. A worktree is a separate directory that
// shares the same object database, so the tree you are working in never moves.
//
// One-time setup on GitHub: Settings -> Pages -> Source -> Deploy from a
// branch -> `gh-pages` / `(root)`.

import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdirSync, cpSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BRANCH = 'gh-pages';
const WORKTREE = join(tmpdir(), 'chesshire-gh-pages');

function git(args, opts = {}) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

/** Like git(), but a non-zero exit is an answer rather than an error. */
function gitTry(args, opts = {}) {
	const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
	return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

// ---------------------------------------------------------------------------
// 1. Where is this going, and under what path?
// ---------------------------------------------------------------------------

const remote = git(['remote', 'get-url', 'origin']);
const repo = remote
	.replace(/\.git$/, '')
	.split(/[/:]/)
	.pop();
if (!repo) throw new Error(`Could not read a repository name from origin: ${remote}`);

// GitHub Pages serves a project site at /<repo>/, so every built URL needs that
// prefix. Derived rather than hardcoded, for the same reason the workflow
// derives it: two copies of a path is one copy too many.
const BASE_PATH = `/${repo}/`;

const sourceCommit = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;

console.log(`Deploying ${repo} at ${BASE_PATH} from ${sourceCommit}${dirty ? ' (+ uncommitted changes)' : ''}`);

// A deploy that does not correspond to any commit is worth saying out loud
// rather than discovering later when the site and the repo disagree.
if (dirty) {
	console.log('  ! Working tree has uncommitted changes; they WILL be published.');
}

// ---------------------------------------------------------------------------
// 2. Build
// ---------------------------------------------------------------------------

// env here rather than a `BASE_PATH=... npm run build` shell prefix: that
// syntax does not exist in cmd.exe or PowerShell, and this has to run on the
// machine the repo actually lives on.
const build = spawnSync('npm', ['run', 'build'], {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, BASE_PATH },
	shell: process.platform === 'win32',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('Build produced no dist/index.html');

verifyBase(DIST, BASE_PATH);

// Pages runs Jekyll over the branch unless told not to, and Jekyll drops files
// and directories whose names begin with an underscore.
writeFileSync(join(DIST, '.nojekyll'), '');

/**
 * Refuse to publish a build whose asset URLs point somewhere else.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS EXISTS TO PREVENT
 *
 * After the repository was renamed, a deploy ran while `git remote get-url`
 * still said the old name. BASE_PATH came out as the old path, so every asset
 * URL in index.html was prefixed with a directory that no longer existed.
 * GitHub Pages answered those requests with its 404 PAGE, which is HTML, and
 * the browser refused to execute HTML as a JavaScript module. The site was
 * blank.
 *
 * The script printed "Pushed. Live shortly." It had verified that the app was
 * DEPLOYED and never that it WORKS — the same omission as the Stockfish 404 in
 * §M9, in a different file.
 *
 * Two things are checked, and they catch different mistakes:
 *   1. every root-absolute URL starts with the base being deployed under
 *      — catches a stale or mismatched BASE_PATH
 *   2. every one of them resolves to a file that is actually in dist/
 *      — catches a missing copy step, or a public/ file nobody generated
 * ---------------------------------------------------------------------------
 */
export function verifyBase(dist, base) {
	const html = readFileSync(join(dist, 'index.html'), 'utf8');
	const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
	const local = urls.filter((u) => u.startsWith('/'));

	const wrongBase = local.filter((u) => !u.startsWith(base));
	if (wrongBase.length) {
		throw new Error(
			`Built for a different base. index.html asks for:\n` +
				wrongBase.map((u) => `  ${u}`).join('\n') +
				`\nbut this deploy is for ${base}.\n` +
				`BASE_PATH comes from the git remote — check \`git remote get-url origin\`.`,
		);
	}

	const missing = local.filter((u) => !existsSync(join(dist, u.slice(base.length))));
	if (missing.length) {
		throw new Error(
			`index.html references files that are not in dist/:\n` +
				missing.map((u) => `  ${u}`).join('\n'),
		);
	}

	console.log(`  ok  ${local.length} asset URLs all under ${base} and present`);
}

// ---------------------------------------------------------------------------
// 3. Put dist/ on the branch, through a worktree
// ---------------------------------------------------------------------------

// A worktree left behind by an interrupted run holds the branch checked out and
// blocks this one. Clearing it is safe: it contains only build output.
rmSync(WORKTREE, { recursive: true, force: true });
gitTry(['worktree', 'prune']);

// Match the remote if it exists, so this adds to the branch's history rather
// than replacing it. A force-push would work and would also throw away anyone
// else's deploy, including your own from another machine.
const hasRemoteBranch = gitTry(['fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`]).ok;

if (hasRemoteBranch) {
	git(['worktree', 'add', '--force', '-B', BRANCH, WORKTREE, `origin/${BRANCH}`]);
} else {
	// First deploy: the branch has no history and should have none. An orphan
	// branch keeps the built output out of the source history entirely, so
	// cloning the repo does not drag every past build along with it.
	mkdirSync(WORKTREE, { recursive: true });
	git(['worktree', 'add', '--detach', WORKTREE]);
	// `switch --orphan` needs git 2.27; `checkout --orphan` has worked forever
	// but leaves the previous tree staged, hence the reset.
	const orphan = spawnSync('git', ['switch', '--orphan', BRANCH], { cwd: WORKTREE });
	if (orphan.status !== 0) {
		execFileSync('git', ['checkout', '--orphan', BRANCH], { cwd: WORKTREE, stdio: 'inherit' });
		execFileSync('git', ['rm', '-rf', '--cached', '.'], { cwd: WORKTREE, stdio: 'ignore' });
	}
}

// Clear everything the last deploy left, so a file deleted from the build is
// deleted from the site. `.git` is the worktree's link back to the repo.
for (const entry of readdirSync(WORKTREE)) {
	if (entry === '.git') continue;
	rmSync(join(WORKTREE, entry), { recursive: true, force: true });
}

cpSync(DIST, WORKTREE, { recursive: true });

const inTree = (args, opts = {}) =>
	execFileSync('git', args, { cwd: WORKTREE, encoding: 'utf8', ...opts });

inTree(['add', '--all']);

const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: WORKTREE });
if (staged.status === 0) {
	console.log('\nNothing changed since the last deploy. Not pushing.');
} else {
	inTree(['commit', '-m', `Deploy ${sourceCommit}${dirty ? '+dirty' : ''}`], {
		stdio: 'inherit',
	});
	inTree(['push', 'origin', BRANCH], { stdio: 'inherit' });

	const owner = remote.replace(/\.git$/, '').split(/[/:]/).at(-2);
	console.log(`\nPushed. Live shortly at https://${owner}.github.io/${repo}/`);
	console.log('First time only: Settings -> Pages -> Deploy from a branch -> gh-pages / (root)');
}

// ---------------------------------------------------------------------------
// 4. Clean up
// ---------------------------------------------------------------------------

gitTry(['worktree', 'remove', '--force', WORKTREE]);
rmSync(WORKTREE, { recursive: true, force: true });
