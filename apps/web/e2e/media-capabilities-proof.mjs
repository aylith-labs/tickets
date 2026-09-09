import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../../packages/server/src/app.ts';
import { EventBus } from '../../../packages/server/src/events.ts';

// Run with the coordinated browser slot and the exact Bun runtime. Uses fresh
// build:web assets, a loopback in-memory API, and a stub publisher. No normal
// daemon, registry, store, Git, external media, terminal or enrichment access.
assert(process.argv.includes('--run'), 'Pass --run only after the coordinator grants the browser slot');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'tickets-media-capabilities-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receipt = {
	startedAt: new Date().toISOString(),
	output,
	bun: Bun.version,
	checks: [],
	requests: [],
	pageErrors: [],
	blockedRequests: [],
	sources: [],
	cleanup: {},
	limitations: [
		'Isolated in-memory ticket API; no owner store, independent restart or public deployment proof.',
		'Publisher is an injected stub; no external publication or provider health is tested.',
		'Older-server and malformed metadata are explicitly injected fixture variants.',
		'Viewport reflow is tested; native browser zoom is not exercised.',
	],
};
for (const path of [
	'packages/server/src/app.ts',
	'packages/core/src/client.ts',
	'packages/ui/src/ticket-detail.ts',
	'packages/server/src/test/capabilities.test.ts',
	'apps/web/e2e/media-capabilities-proof.mjs',
	'apps/web/dist/main.js',
	'apps/web/dist/index.html',
]) {
	const bytes = await readFile(join(root, path));
	receipt.sources.push({
		path,
		sha256: sha256(bytes),
		bytes: bytes.length,
		crBytes: bytes.filter((b) => b === 13).length,
	});
}
const main = await readFile(join(root, 'apps/web/dist/main.js'));
const index = await readFile(join(root, 'apps/web/dist/index.html'));
const existing = ['before', 'after', 'other'].map((kind) => ({
	kind,
	type: 'image',
	url: `/fixture-${kind}.svg`,
	label: `Existing ${kind} evidence`,
}));
let ticket = {
	id: '0001',
	title: 'Media capability fixture',
	description: 'Existing evidence remains useful without uploads.',
	status: 'todo',
	archived: false,
	created: '2026-09-08T00:00:00.000Z',
	attachments: structuredClone(existing),
};
const unused = async () => {
	throw new Error('Unexpected fixture operation');
};
const adapter = {
	list: async () => [ticket],
	get: async (id) => (id === ticket.id ? ticket : null),
	create: unused,
	update: async (id, patch) => {
		assert.equal(id, ticket.id);
		ticket = { ...ticket, ...patch };
		return ticket;
	},
	archive: unused,
	getRevisions: async () => [],
	getRevision: unused,
	restoreRevision: unused,
};
let publishCalls = 0;
let failUpload = false;
let holdUpload;
const context = {
	config: {
		port: 0,
		apiBase: '/api',
		statuses: ['todo', 'done'],
		storeRoot: '/unused-fixture',
		worktreesRoot: '/unused-fixture',
		projects: [
			{ id: 'fixture', name: 'Fixture', repoPath: '/unused-fixture', adapter: 'folder', dataDir: '/unused-fixture' },
		],
		terminals: [],
		enrich: { defaultProvider: '', providers: [] },
	},
	adapters: new Map([['fixture', adapter]]),
	events: new EventBus(),
	runCommand: () => {
		throw new Error('Unexpected command');
	},
	enrich: unused,
	publishMedia: async (input) => {
		publishCalls += 1;
		if (holdUpload) await holdUpload;
		if (failUpload) throw new Error('Fixture upload failed; try again');
		return { url: '/fixture-upload.svg', kind: input.kind, type: 'image', label: 'Fixture upload' };
	},
};
let mode = 'local';
let app = createApp(context, { local: true });
const setMode = (value) => {
	mode = value;
	context.config.media =
		value === 'configured'
			? { repoPath: '/unused-media', baseUrl: 'http://127.0.0.1/media', pathPrefix: 'fixture' }
			: undefined;
	app = createApp(context, { local: value === 'local' });
};
let server;
let browser;
let browserContext;
let releaseUpload;
try {
	server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		idleTimeout: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === '/main.js') return new Response(main, { headers: { 'content-type': 'text/javascript' } });
			if (/^\/fixture-(before|after|other|upload)\.svg$/.test(url.pathname)) {
				return new Response(
					'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#bca48b"/><text x="20" y="100">Local fixture evidence</text></svg>',
					{ headers: { 'content-type': 'image/svg+xml' } },
				);
			}
			if (url.pathname.startsWith('/api/')) {
				const response = await app.fetch(request);
				if (url.pathname === '/api/projects' && ['older-server', 'missing-field', 'malformed'].includes(mode)) {
					const meta = await response.json();
					if (mode === 'older-server') delete meta.capabilities;
					if (mode === 'missing-field') meta.capabilities = {};
					if (mode === 'malformed') meta.capabilities = { mediaUpload: { available: 'true' } };
					return Response.json(meta);
				}
				return response;
			}
			return new Response(index, { headers: { 'content-type': 'text/html' } });
		},
	});
	const base = `http://127.0.0.1:${server.port}`;
	receipt.base = base;
	const playwrightPath = fileURLToPath(
		new URL('../../../../aylith-venture/apps/web/node_modules/@playwright/test/index.mjs', import.meta.url),
	);
	const { chromium, expect } = await import(pathToFileURL(playwrightPath).href);
	browser = await chromium.launch({ headless: true });
	receipt.browser = browser.version();
	browserContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		reducedMotion: 'reduce',
		serviceWorkers: 'block',
	});
	await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
	await browserContext.route('**/*', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin !== base || /\/(launch|enrich|prompt|restore)(\/|$)/.test(url.pathname)) {
			receipt.blockedRequests.push(request.url());
			return route.abort('blockedbyclient');
		}
		receipt.requests.push({ method: request.method(), path: url.pathname });
		return route.continue();
	});
	const page = await browserContext.newPage();
	page.setDefaultTimeout(10_000);
	page.on('pageerror', (error) => receipt.pageErrors.push(String(error)));
	const detail = page.locator('ay-ticket-detail');
	const open = async () => {
		await page.goto(`${base}/fixture?ticket=0001`);
		await expect(detail.locator('.panel')).toBeVisible();
		await expect(detail.locator('img')).toHaveCount(ticket.attachments.length);
	};
	const layout = async (label) => {
		const measurement = await detail.evaluate((element) => {
			const panel = element.shadowRoot.querySelector('.panel');
			const ancestors = [];
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				ancestors.push({ tag: parent.tagName, left: parent.scrollLeft, top: parent.scrollTop });
			}
			const rect = panel.getBoundingClientRect();
			return {
				documentOverflow: document.documentElement.scrollWidth - innerWidth,
				panelOverflow: panel.scrollWidth - panel.clientWidth,
				left: rect.left,
				right: rect.right,
				width: innerWidth,
				ancestors,
				imagesLoaded: [...element.shadowRoot.querySelectorAll('img')].every(
					(image) => image.complete && image.naturalWidth > 0,
				),
			};
		});
		assert(measurement.documentOverflow <= 1 && measurement.panelOverflow <= 1, JSON.stringify(measurement));
		assert(measurement.left >= 0 && measurement.right <= measurement.width, JSON.stringify(measurement));
		assert(
			measurement.ancestors.every((ancestor) => ancestor.left === 0),
			'No hidden ancestor horizontal scroll',
		);
		assert(measurement.imagesLoaded, 'Existing fixture attachments load');
		receipt.checks.push({ name: label, ...measurement });
	};
	for (const value of ['local', 'not-configured', 'older-server', 'missing-field', 'malformed']) {
		setMode(value);
		await open();
		const reason =
			value === 'local'
				? 'Media uploads are unavailable in local mode.'
				: value === 'not-configured'
					? 'Media uploads are not configured.'
					: 'Media upload availability is unknown.';
		await expect(detail.locator('.media-note')).toHaveText(reason);
		await expect(detail.getByRole('button', { name: /Add (before|after) media/ })).toHaveCount(0);
		await expect(detail.locator('input[type=file]')).toHaveCount(0);
		await expect(detail.locator('.upload-error')).toHaveCount(0);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			await detail.locator('.media-note').scrollIntoViewIfNeeded();
			await layout(`${value} narrow ${colorScheme} end`);
			await page.screenshot({ path: join(output, `${value}-${colorScheme}.png`) });
		}
		await detail.getByRole('button', { name: 'Edit', exact: true }).focus();
		await page.keyboard.press('Enter');
		await detail.locator('input[name=title]').fill(`Saved ${value}`);
		await detail.locator('textarea[name=description]').fill(`Edited with ${value} uploads`);
		await detail.getByRole('button', { name: 'Save', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(detail.getByRole('heading', { name: `Saved ${value}`, exact: true })).toBeVisible();
		await detail.getByRole('combobox', { name: 'Status', exact: true }).selectOption('done');
		await expect.poll(() => ticket.status).toBe('done');
		await open();
		assert.equal(ticket.title, `Saved ${value}`);
		assert.equal(ticket.description, `Edited with ${value} uploads`);
		assert.deepEqual(ticket.attachments, existing);
		assert.equal(publishCalls, 0);
		receipt.checks.push({ name: `${value}: no upload, existing evidence, keyboard edit/status and reload` });
	}
	setMode('configured');
	await open();
	await expect(detail.getByRole('button', { name: 'Add before media', exact: true })).toBeEnabled();
	await expect(detail.getByRole('button', { name: 'Add after media', exact: true })).toBeEnabled();
	// A picker already opened before metadata changes must not reach attach.
	for (const capabilities of [undefined, {}, { mediaUpload: { available: false, reason: 'local-mode' } }]) {
		await detail.evaluate((element, next) => {
			const input = element.shadowRoot.querySelector('#media-before');
			const button = [...element.shadowRoot.querySelectorAll('button')].find((candidate) =>
				candidate.textContent.includes('Add before media'),
			);
			const files = new DataTransfer();
			files.items.add(new File(['fixture'], 'stale.png', { type: 'image/png' }));
			input.files = files.files;
			element.meta = { ...element.meta, capabilities: next };
			button.click();
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}, capabilities);
		await expect(detail.locator('input[type=file]')).toHaveCount(0);
		assert.equal(publishCalls, 0);
		await open();
	}
	receipt.checks.push({ name: 'Stale picker and programmatic click blocked for missing/unknown/disabled metadata' });
	failUpload = true;
	holdUpload = new Promise((resolve) => {
		releaseUpload = resolve;
	});
	const choose = async (name, key) => {
		const button = detail.getByRole('button', { name, exact: true });
		await button.focus();
		const picker = page.waitForEvent('filechooser');
		await page.keyboard.press(key);
		await (await picker).setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('local fixture') });
	};
	await choose('Add before media', 'Enter');
	await expect(detail.getByRole('button', { name: 'Uploading…', exact: true })).toBeDisabled();
	await expect(detail.getByRole('button', { name: 'Add after media', exact: true })).toBeDisabled();
	await expect.poll(() => publishCalls).toBe(1);
	releaseUpload();
	holdUpload = undefined;
	await expect(detail.getByRole('status')).toHaveText('Fixture upload failed; try again');
	assert.deepEqual(ticket.attachments, existing);
	await expect(detail.getByRole('button', { name: 'Add before media', exact: true })).toBeEnabled();
	await page.screenshot({ path: join(output, 'configured-error-dark.png') });
	failUpload = false;
	await choose('Add before media', 'Space');
	await expect(detail.locator('img')).toHaveCount(4);
	await expect(detail.locator('.upload-error')).toHaveCount(0);
	await choose('Add after media', 'Enter');
	await expect(detail.locator('img')).toHaveCount(5);
	assert.equal(publishCalls, 3);
	assert.deepEqual(ticket.attachments.slice(0, 3), existing);
	assert.equal(ticket.attachments[3].kind, 'before');
	assert.equal(ticket.attachments[4].kind, 'after');
	receipt.checks.push({
		name: 'Configured native keyboard buttons, pending disable, error and same-file retry, both kinds',
		publishCalls,
	});
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		for (const docked of [false, true]) {
			await detail.evaluate((element, value) => {
				element.docked = value;
			}, docked);
			for (const colorScheme of ['light', 'dark']) {
				await page.emulateMedia({ colorScheme });
				await detail.getByRole('button', { name: 'Add before media', exact: true }).focus();
				await layout(`configured ${width} ${docked ? 'docked' : 'modal'} ${colorScheme} end/focus`);
				await page.screenshot({ path: join(output, `configured-${width}-${docked}-${colorScheme}.png`) });
			}
		}
	}
	assert.deepEqual(receipt.pageErrors, []);
	assert.deepEqual(receipt.blockedRequests, []);
	receipt.passed = true;
} catch (error) {
	receipt.passed = false;
	receipt.error = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	releaseUpload?.();
	if (browserContext) {
		await browserContext.tracing.stop({ path: join(output, 'trace.zip') });
		await browserContext.close();
		receipt.cleanup.contextClosed = true;
	}
	if (browser) {
		await browser.close();
		receipt.cleanup.browserClosed = true;
	}
	if (server) {
		await server.stop(true);
		receipt.cleanup.serverStopped = true;
	}
	receipt.finishedAt = new Date().toISOString();
	await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(
		JSON.stringify({
			passed: receipt.passed,
			output,
			checks: receipt.checks.length,
			error: receipt.error,
			cleanup: receipt.cleanup,
		}),
	);
}
