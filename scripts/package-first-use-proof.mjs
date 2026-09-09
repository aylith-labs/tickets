/** Local package proof. Never publishes; all consumers/config/data live in a new temp root.
 * prepare --bun <exe> --npm <exe> --git <exe>
 * browser --root <prepared-root> [--form-proof <module>]
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [phase, ...args] = process.argv.slice(2);
const option = (key) => {
	const index = args.indexOf(`--${key}`);
	return index >= 0 ? args[index + 1] : undefined;
};
const required = (key) => {
	assert(option(key), `Missing --${key}`);
	return resolve(option(key));
};
const source = fileURLToPath(new URL('../', import.meta.url));
const root = phase === 'prepare' ? await mkdtemp(join(tmpdir(), 'tickets-package-proof-')) : required('root');
assert(root.startsWith(`${resolve(tmpdir())}${sep}`), 'Proof data must stay in the temp directory');
const output = phase === 'prepare' ? root : await mkdtemp(join(root, 'browser-'));
const now = () => new Date().toISOString();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
const receipt = { phase, root, output, startedAt: now(), checks: [], commands: [], jobs: [] };
const save = () => json(join(output, 'receipt.json'), receipt);
const check = async (name, detail) => {
	receipt.checks.push({ name, detail, at: now() });
	await save();
};
console.log(JSON.stringify({ phase, root, output }));

async function run(executable, argv, cwd, env) {
	const record = { executable, argv, cwd, startedAt: now() };
	const child = spawn(executable, argv, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '',
		stderr = '';
	child.stdout.on('data', (bytes) => {
		stdout += bytes;
	});
	child.stderr.on('data', (bytes) => {
		stderr += bytes;
	});
	const timer = setTimeout(() => child.kill(), 120000);
	try {
		const [code, signal] = await once(child, 'close');
		Object.assign(record, { code, signal, stdout, stderr, endedAt: now() });
	} finally {
		clearTimeout(timer);
	}
	receipt.commands.push(record);
	await save();
	assert.equal(record.code, 0, `${executable}: ${stderr}`);
	return stdout;
}

function isolatedEnv(profile, git, bun, npm) {
	const env = {};
	for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return {
		...env,
		PATH: [
			dirname(bun),
			dirname(process.execPath),
			dirname(git),
			dirname(npm),
			join(process.env.SystemRoot, 'System32'),
		].join(';'),
		HOME: profile,
		USERPROFILE: profile,
		HOMEDRIVE: profile.slice(0, 2),
		HOMEPATH: profile.slice(2),
		APPDATA: join(profile, 'AppData/Roaming'),
		LOCALAPPDATA: join(profile, 'AppData/Local'),
		XDG_CONFIG_HOME: join(profile, '.config'),
		XDG_CACHE_HOME: join(profile, '.cache'),
		TEMP: join(profile, 'tmp'),
		TMP: join(profile, 'tmp'),
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: join(profile, '.gitconfig'),
		GIT_TERMINAL_PROMPT: '0',
		NPM_CONFIG_USERCONFIG: join(profile, '.npmrc'),
		NPM_CONFIG_GLOBALCONFIG: join(profile, 'global.npmrc'),
		NPM_CONFIG_CACHE: join(profile, '.npm-cache'),
	};
}

const live = new Set();
let browser, context;
async function stop(job) {
	if (job.child.exitCode === null && job.child.signalCode === null) {
		const closed = once(job.child, 'close');
		job.child.kill();
		await closed;
	}
	Object.assign(job.record, { exitedAt: now(), exitCode: job.child.exitCode, signal: job.child.signalCode });
	await writeFile(join(output, `${job.record.label}.log`), job.stdout + job.stderr);
	live.delete(job);
	await save();
}
async function freePort() {
	const probe = createServer();
	probe.listen(0, '127.0.0.1');
	await once(probe, 'listening');
	const { port } = probe.address();
	probe.close();
	await once(probe, 'close');
	return port;
}
async function start(state, port, label, umbrella = false) {
	const entry = join(
		state.consumer,
		umbrella ? 'node_modules/@aylith/tickets/bin/tickets.js' : 'node_modules/@aylith/tickets-server/dist/cli.js',
	);
	const child = spawn(state.bun, ['--no-env-file', entry, 'serve', '--port', String(port)], {
		cwd: state.repo,
		env: state.env,
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const job = { child, stdout: '', stderr: '', record: { label, pid: child.pid, entry, port, startedAt: now() } };
	live.add(job);
	receipt.jobs.push(job.record);
	child.stdout.on('data', (bytes) => {
		job.stdout += bytes;
	});
	child.stderr.on('data', (bytes) => {
		job.stderr += bytes;
	});
	const base = `http://127.0.0.1:${port}`;
	for (let attempt = 0; attempt < 100; attempt++) {
		assert.equal(child.exitCode, null, job.stderr);
		try {
			const response = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1000) });
			if (response.ok && response.headers.get('content-type')?.includes('application/json')) return { job, base };
		} catch {}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`Daemon readiness failed: ${job.stderr}`);
}

try {
	if (phase === 'prepare') {
		assert.equal(process.platform, 'win32', 'This retained proof is Windows-scoped');
		const bun = required('bun'),
			npm = required('npm'),
			git = required('git');
		const profile = join(root, 'profile'),
			consumer = join(root, 'consumer'),
			repo = join(root, 'project');
		const archives = join(root, 'archives');
		for (const dir of [profile, consumer, repo, archives, join(profile, 'tmp')]) await mkdir(dir, { recursive: true });
		await writeFile(
			join(profile, '.npmrc'),
			'registry=https://registry.npmjs.org/\naudit=false\nfund=false\nignore-scripts=true\n',
		);
		await writeFile(join(profile, 'global.npmrc'), '');
		const env = isolatedEnv(profile, git, bun, npm);
		const home = (
			await run(bun, ['--no-env-file', '-e', 'console.log(require("node:os").homedir())'], consumer, env)
		).trim();
		assert.equal(resolve(home), resolve(profile));
		const dependencies = {},
			packed = [];
		for (const name of ['core', 'ui', 'server', 'tui', 'tickets']) {
			const pkgRoot = join(source, 'packages', name),
				pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'));
			// Pack is not publish. Ignore lifecycle scripts here because main already ran the explicit build/asset gate.
			await run(
				bun,
				['--no-env-file', 'pm', 'pack', '--ignore-scripts', '--destination', archives, '--quiet'],
				pkgRoot,
				env,
			);
			const filename = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
			const path = join(archives, filename);
			packed.push({ name: pkg.name, version: pkg.version, path, sha256: hash(await readFile(path)) });
			dependencies[pkg.name] = `file:${path.replaceAll('\\', '/')}`;
		}
		await json(join(consumer, 'package.json'), {
			name: 'tickets-isolated-proof',
			private: true,
			type: 'module',
			dependencies,
		});
		await run(
			npm.endsWith('.js') ? process.execPath : npm,
			[...(npm.endsWith('.js') ? [npm] : []), 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
			consumer,
			env,
		);
		for (const item of packed) {
			const pkg = JSON.parse(await readFile(join(consumer, 'node_modules', item.name, 'package.json'), 'utf8'));
			assert.equal(pkg.version, item.version);
		}
		const assets = [];
		for (const name of ['index.html', 'main.js', 'components.js']) {
			const path = join(consumer, 'node_modules/@aylith/tickets-server/dist/web', name),
				bytes = await readFile(path);
			assert(bytes.length > 0);
			assert.equal(hash(bytes), hash(await readFile(join(source, 'packages/server/dist/web', name))));
			assets.push({ name, sha256: hash(bytes), bytes: bytes.length });
		}
		await run(git, ['init', '-b', 'main'], repo, env);
		const cli = join(consumer, 'node_modules/@aylith/tickets/bin/tickets.js');
		await run(bun, ['--no-env-file', cli, 'init', '--adapter', 'folder', '--name', 'Packaged proof'], repo, env);
		const configPath = join(profile, '.config/aylith-tickets/config.json');
		const config = JSON.parse(await readFile(configPath, 'utf8'));
		assert.equal(config.projects.length, 1);
		const project = config.projects[0];
		assert(project.id);
		assert.equal(project.location.kind, 'folder');
		assert((await stat(join(project.location.dataDir, 'tickets'))).isDirectory());
		const state = { root, bun, consumer, repo, env, project, assets, packed, configPath };
		await json(join(root, 'state.json'), state);
		await check('fresh local archives install with complete matching web assets', {
			packed,
			assets,
			node: process.version,
			bun: (await run(bun, ['--version'], consumer, env)).trim(),
		});
		await check('installed umbrella CLI initializes existing source folder before daemon/watch', {
			project,
			home,
			initialFiles: await readdir(join(project.location.dataDir, 'tickets')),
		});
	} else if (phase === 'browser') {
		const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
		const { chromium } = await import(pathToFileURL(join(source, '../dashcam/node_modules/playwright/index.mjs')).href);
		const { expect } = await import(
			pathToFileURL(join(source, 'apps/web/node_modules/@playwright/test/index.mjs')).href
		);
		const port = await freePort();
		let { job, base } = await start(state, port, 'dist-cli-first');
		const get = async (path) => {
			const response = await fetch(base + path);
			assert.equal(response.status, 200);
			return response.json();
		};
		const meta = await get('/api/projects');
		assert.equal(meta.projects[0].id, state.project.id);
		for (const asset of state.assets) {
			const response = await fetch(`${base}/${asset.name === 'index.html' ? '' : asset.name}`);
			assert.equal(response.status, 200);
			assert.equal(hash(Buffer.from(await response.arrayBuffer())), asset.sha256);
		}
		browser = await chromium.launch({ headless: true });
		context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			colorScheme: 'light',
			reducedMotion: 'reduce',
			recordVideo: { dir: join(output, 'capture') },
		});
		receipt.browser = browser.version();
		receipt.pageErrors = [];
		receipt.requests = [];
		receipt.blocked = [];
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.origin === base && !/\/(launch|enrich|attachments|prompt|restore)(\/|$)/.test(url.pathname))
				return route.continue();
			receipt.blocked.push(url.href);
			return route.abort();
		});
		const page = await context.newPage();
		page.setDefaultTimeout(10000);
		page.on('pageerror', (error) => receipt.pageErrors.push(error.message));
		page.on('request', (request) => receipt.requests.push({ method: request.method(), url: request.url() }));
		await page.goto(base);
		await expect(page.locator('ay-ticket-form')).toBeVisible();
		const documentOrigin = await page.evaluate(() => performance.timeOrigin);
		await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const source = new EventSource('/api/events');
					window.__watchProof = { source, changes: [] };
					source.addEventListener('change', (event) => window.__watchProof.changes.push(event.data));
					source.onopen = () => resolve();
					source.onerror = () => reject(new Error('SSE failed to open'));
				}),
		);
		// A source-owned file write, not an API event injection: exercise the empty-store watcher.
		const externalFile = join(state.project.location.dataDir, 'tickets', '0001.md');
		const external = (title) =>
			`---\nid: '0001'\ntitle: ${title}\nstatus: todo\narchived: false\ncreated: '${now()}'\n---\nSource-file watcher proof.\n`;
		await writeFile(externalFile, external('External first ticket'));
		await expect(page.locator('ay-ticket-card').getByText('External first ticket', { exact: true })).toBeVisible();
		await writeFile(externalFile, external('External edit without restart'));
		await expect(
			page.locator('ay-ticket-card').getByText('External edit without restart', { exact: true }),
		).toBeVisible();
		assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin);
		assert((await page.evaluate(() => window.__watchProof.changes.length)) >= 2);
		await page.evaluate(() => window.__watchProof.source.close());
		await check('first external file and subsequent edit reach open browser without restart/reload', {
			projectId: state.project.id,
			documentOrigin,
		});
		if (!(await page.locator('ay-ticket-form').isVisible()))
			await page.getByRole('button', { name: 'New ticket', exact: true }).click();
		const form = page.locator('ay-ticket-form');
		await form.locator('input[name=title]').fill('Created from installed npm app');
		await form.locator('select[name=project]').selectOption(state.project.id);
		await form.locator('textarea[name=description]').fill('A real local package, not a checkout fallback.');
		const creation = page.waitForResponse(
			(response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/tickets',
		);
		await form.getByRole('button', { name: 'Create ticket', exact: true }).click();
		const response = await creation;
		assert.equal(response.status(), 201);
		const created = await response.json();
		assert.equal(created.projectId, state.project.id);
		await expect(page.locator('ay-ticket-card').getByText(created.title, { exact: true })).toBeVisible();
		await page.screenshot({ path: join(output, 'installed-created.png'), fullPage: true });
		await context.close();
		context = undefined;
		await browser.close();
		browser = undefined;
		if (option('form-proof')) {
			const module = await import(pathToFileURL(required('form-proof')).href);
			receipt.formProof = await module.runFormProof({ base, output: join(output, 'form'), browserSlotHeld: true });
			assert.equal(receipt.formProof.passed, true);
		}
		const before = (await get('/api/tickets')).tickets;
		await json(join(output, 'before-restart.json'), before);
		await stop(job);
		await assert.rejects(fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1000) }));
		({ job, base } = await start(state, port, 'umbrella-bun-export-restart', true));
		const after = (await get('/api/tickets')).tickets;
		assert.deepEqual(after, before);
		assert.equal(new Set(after.map((item) => item.id)).size, after.length);
		await json(join(output, 'after-restart.json'), after);
		browser = await chromium.launch({ headless: true });
		context = await browser.newContext();
		await context.route('**/*', (route) =>
			new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
		);
		const restarted = await context.newPage();
		restarted.setDefaultTimeout(10000);
		await restarted.goto(`${base}/${state.project.id}?ticket=${created.id}`);
		await expect(restarted.getByRole('heading', { name: created.title, exact: true })).toBeVisible();
		await restarted.screenshot({ path: join(output, 'restarted-deep-link.png'), fullPage: true });
		await check('dist CLI and umbrella Bun export serve package UI and retain all records after process restart', {
			oldPid: receipt.jobs[0].pid,
			newPid: job.record.pid,
			tickets: after.length,
			createdId: created.id,
		});
		assert.deepEqual(receipt.pageErrors, []);
		assert.deepEqual(receipt.blocked, []);
		assert(!job.stderr.includes('cannot watch'), job.stderr);
	} else throw new Error('Expected prepare or browser');
	receipt.passed = true;
} catch (error) {
	receipt.passed = false;
	receipt.error = error.stack || String(error);
	process.exitCode = 1;
	const page = context?.pages()[0];
	if (page) {
		await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
		await writeFile(join(output, 'failure.aria.txt'), await page.locator('body').ariaSnapshot()).catch(() => {});
	}
} finally {
	if (context) await context.close();
	if (browser) await browser.close();
	for (const job of live) await stop(job);
	receipt.finishedAt = now();
	await save();
	console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error, output }));
}
