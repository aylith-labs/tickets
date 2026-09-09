import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultPlaywright = 'C:/Users/steve/projects/aylith-labs/dashcam/node_modules/playwright/index.mjs';
const defaultSlot = join(tmpdir(), 'aylith-first-use-browser.lock');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(read, predicate, label) {
	const deadline = Date.now() + 12_000;
	let value;
	do {
		value = await read();
		if (predicate(value)) return value;
		await delay(40);
	} while (Date.now() < deadline);
	throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
}

/**
 * Exercise the supplied, already built and served Tickets UI. Never builds,
 * installs, authenticates, starts a server, or opens real user projects.
 *
 * The caller must supply a task-isolated fixture and identify it with fixtureLabel.
 * mode: 'all' (default), 'normal' (genuine API only), or 'injected' (fault cases).
 * A supplied browser remains caller-owned. Every context here is fresh and closed.
 * browserSlotHeld is only for a caller that already owns the coordinated slot;
 * otherwise this acquires browserSlotPath exclusively and never removes a stale lock.
 * Returned savedTickets contain genuine API records for caller reload/restart checks.
 */
export async function runFormFirstUseProof(baseUrl, options = {}) {
	const base = new URL(baseUrl);
	assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a task-isolated loopback fixture');
	assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
	assert(options.fixtureLabel, 'Identify the caller-owned isolated fixture with fixtureLabel');
	const mode = options.mode ?? 'all';
	assert(['all', 'normal', 'injected'].includes(mode));
	const outputDir = options.outputDir
		? resolve(options.outputDir)
		: await mkdtemp(join(tmpdir(), 'tickets-form-proof-'));
	await mkdir(outputDir, { recursive: true });
	const slotPath = options.browserSlotPath ?? defaultSlot;
	let slot;
	let browser;
	let context;
	let releaseFailure;
	const receipt = {
		startedAt: new Date().toISOString(),
		baseUrl: base.href,
		fixtureLabel: options.fixtureLabel,
		mode,
		outputDir,
		runtimeIdentity: options.runtimeIdentity ?? null,
		browserSlot: options.browserSlotHeld ? 'caller-held' : slotPath,
		node: process.version,
		platform: process.platform,
		checks: [],
		savedTickets: [],
		assets: [],
		assetErrors: [],
		requests: [],
		pageErrors: [],
		console: [],
		blockedRequests: [],
		injections: [],
		limitations: [
			'Local fixture only; no published release, owner identity, TUI, agent or media acceptance.',
			'Viewport reflow is measured; native browser zoom is not exercised.',
			'Failed POST is injected before any server write; ambiguous post-commit loss is not tested.',
			'Caller owns startup, installed package identity and independent process restart.',
		],
	};
	const check = (name, evidence = {}) => receipt.checks.push({ name, ...evidence });
	try {
		if (!options.browserSlotHeld) {
			await mkdir(dirname(slotPath), { recursive: true });
			slot = await open(slotPath, 'wx');
			await slot.writeFile(
				JSON.stringify({ pid: process.pid, fixtureLabel: options.fixtureLabel, startedAt: receipt.startedAt }),
			);
		}
		const playwrightPath = options.playwrightPath ?? defaultPlaywright;
		const { chromium } = await import(pathToFileURL(playwrightPath).href);
		browser = options.browser ?? (await chromium.launch({ headless: true }));
		receipt.browser = browser.version();
		try {
			receipt.playwright = JSON.parse(await readFile(join(dirname(playwrightPath), 'package.json'), 'utf8')).version;
		} catch {
			receipt.playwright = 'caller module; version unavailable';
		}
		context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			serviceWorkers: 'block',
			reducedMotion: 'reduce',
		});
		await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
		const page = await context.newPage();
		page.setDefaultTimeout(12_000);
		page.on('pageerror', (error) => receipt.pageErrors.push(String(error)));
		page.on('console', (message) => {
			if (['error', 'warning'].includes(message.type()))
				receipt.console.push({ type: message.type(), text: message.text() });
		});
		page.on('request', (request) => receipt.requests.push({ method: request.method(), url: request.url() }));
		const assetWork = [];
		page.on('response', (response) => {
			const url = new URL(response.url());
			if (
				url.origin === base.origin &&
				(url.pathname.endsWith('.js') || response.request().resourceType() === 'document')
			) {
				assetWork.push(
					response
						.body()
						.then((body) =>
							receipt.assets.push({
								url: response.url(),
								status: response.status(),
								bytes: body.length,
								sha256: sha256(body),
							}),
						)
						.catch((error) => receipt.assetErrors.push({ url: response.url(), error: String(error) })),
				);
			}
		});
		let injectedPost = false;
		let heldPost = false;
		let postCount = 0;
		let heldBody;
		let failureGate;
		await context.route('**/*', async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (url.origin !== base.origin || /\/(launch|enrich|attachments|prompt|restore)(\/|$)/.test(url.pathname)) {
				receipt.blockedRequests.push({ url: url.href, method: request.method() });
				return route.abort('blockedbyclient');
			}
			if (!['GET', 'HEAD'].includes(request.method())) {
				assert.equal(request.method(), 'POST', 'Only the scoped form create may write');
				assert.equal(url.pathname, '/api/tickets');
				postCount += 1;
				if (injectedPost) {
					heldPost = true;
					heldBody = request.postDataJSON();
					await failureGate;
					return route.fulfill({
						status: 503,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'Injected pre-write save failure for form proof' }),
					});
				}
			}
			return route.continue();
		});
		const json = async (path) => {
			const response = await context.request.get(new URL(path, base.origin).href);
			assert.equal(response.status(), 200, path);
			return response.json();
		};
		const meta = await json('/api/projects');
		receipt.metadata = meta;
		const candidates = meta.projects.filter((project) => !project.unavailable);
		const project = options.projectKey
			? candidates.find((entry) => (entry.id ?? entry.name) === options.projectKey)
			: candidates[0];
		assert(project, 'Fixture needs at least one available project for the genuine UI journey');
		const projectKey = project.id ?? project.name;
		const initial = await json('/api/tickets');
		receipt.initialTicketCount = initial.tickets.length;
		await page.goto(base.href, { waitUntil: 'domcontentloaded' });
		const form = () => page.locator('ay-ticket-form').last();
		const title = () => form().getByRole('textbox', { name: 'Title', exact: true });
		const description = () => form().getByRole('textbox', { name: 'Description', exact: true });
		const create = () => form().getByRole('button', { name: 'Create ticket', exact: true });
		const openForm = async () => {
			if ((await page.locator('ay-ticket-form').count()) === 0) {
				const button = page.getByRole('button', { name: 'New ticket', exact: true });
				await button.focus();
				await button.press('Enter');
			}
			await title().waitFor({ state: 'visible' });
			assert(
				await title().evaluate((element) => element.getRootNode().activeElement === element),
				'Title receives opening focus',
			);
		};
		const selectProject = async (key) => {
			const select = form().getByRole('combobox', { name: 'Project', exact: true });
			if ((await select.count()) === 0) {
				assert.equal(await form().getAttribute('project'), key);
				return;
			}
			await until(() => select.isEnabled(), Boolean, 'project selection enabled');
			const index = await select.evaluate(
				(element, value) => Array.from(element.options).findIndex((option) => option.value === value),
				key,
			);
			assert(index > 0, 'Explicit project placeholder followed by fixture project');
			await title().press('Tab');
			assert(await select.evaluate((element) => element.getRootNode().activeElement === element));
			await select.press('Home');
			// Keyboard selection skips disabled options, as the native control does.
			const steps = await select.evaluate(
				(element, end) =>
					Array.from(element.options)
						.slice(1, end + 1)
						.filter((option) => !option.disabled).length,
				index,
			);
			for (let i = 0; i < steps; i += 1) await select.press('ArrowDown');
			await select.press('Tab');
			assert.equal(await select.inputValue(), key);
		};
		const bounds = async (label) => {
			const evidence = await form().evaluate((host) => {
				const box = (element) => {
					const rect = element.getBoundingClientRect();
					return {
						tag: element.tagName,
						name: element.getAttribute('name'),
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
						scrollLeft: element.scrollLeft,
						scrollWidth: element.scrollWidth,
						clientWidth: element.clientWidth,
						overflowX: getComputedStyle(element).overflowX,
					};
				};
				const ancestors = [];
				for (let element = host; element; element = element.parentElement ?? element.getRootNode().host)
					ancestors.push(box(element));
				return {
					viewport: innerWidth,
					documentWidth: document.documentElement.scrollWidth,
					documentLeft: document.documentElement.scrollLeft,
					controls: Array.from(host.shadowRoot.querySelectorAll('input, select, textarea, button')).map(box),
					ancestors,
				};
			});
			await page.screenshot({ path: join(outputDir, `${label}.png`), fullPage: true });
			await writeFile(join(outputDir, `${label}.aria.txt`), await page.locator('body').ariaSnapshot());
			receipt.checks.push({ name: label, ...evidence });
			assert(evidence.documentWidth <= evidence.viewport + 1, `${label}: document overflows`);
			assert.equal(evidence.documentLeft, 0, `${label}: document shifted horizontally`);
			for (const control of evidence.controls) {
				assert(
					control.left >= -1 && control.right <= evidence.viewport + 1,
					`${label}: ${control.name ?? control.tag} clipped`,
				);
			}
			for (const ancestor of evidence.ancestors) {
				if (!['auto', 'scroll'].includes(ancestor.overflowX))
					assert.equal(ancestor.scrollLeft, 0, `${label}: hidden ancestor shifted`);
			}
		};
		const createContrast = async () => {
			await until(() => create().isEnabled(), Boolean, 'enabled Create contrast check');
			const results = [];
			for (const state of ['default', 'hover', 'keyboard-focus']) {
				await page.mouse.move(0, 0);
				await title().focus();
				if (state === 'hover') await create().hover();
				if (state === 'keyboard-focus') {
					await description().focus();
					await description().press('Shift+Tab');
				}
				const colors = await create().evaluate((button) => {
					const style = getComputedStyle(button);
					const canvas = document.createElement('canvas');
					canvas.width = canvas.height = 1;
					const context = canvas.getContext('2d', { willReadFrequently: true });
					const rgba = (color) => {
						context.clearRect(0, 0, 1, 1);
						context.fillStyle = color;
						context.fillRect(0, 0, 1, 1);
						return Array.from(context.getImageData(0, 0, 1, 1).data);
					};
					return {
						color: style.color,
						background: style.backgroundColor,
						foregroundRgba: rgba(style.color),
						backgroundRgba: rgba(style.backgroundColor),
						filter: style.filter,
						opacity: style.opacity,
						focusVisible: button.matches(':focus-visible'),
						outlineStyle: style.outlineStyle,
						outlineWidth: style.outlineWidth,
					};
				});
				assert.equal(colors.opacity, '1', 'Contrast measures enabled opaque button');
				assert.equal(colors.foregroundRgba[3], 255);
				assert.equal(colors.backgroundRgba[3], 255);
				let brightness = 1;
				if (colors.filter !== 'none') {
					const match = /^brightness\(([\d.]+)\)$/.exec(colors.filter);
					assert(match, `Unsupported contrast filter: ${colors.filter}`);
					brightness = Number(match[1]);
				}
				const luminance = (rgba) =>
					rgba
						.slice(0, 3)
						.map((byte) => {
							const channel = Math.min(255, byte * brightness) / 255;
							return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
						})
						.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
				const foreground = luminance(colors.foregroundRgba);
				const background = luminance(colors.backgroundRgba);
				const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
				results.push({ state, contrast, ...colors });
				assert(contrast >= 4.5, `Create ${state} text contrast ${contrast.toFixed(3)} < 4.5`);
				if (state === 'keyboard-focus') {
					assert(
						colors.focusVisible && colors.outlineStyle !== 'none' && parseFloat(colors.outlineWidth) > 0,
						'Keyboard focus remains visible',
					);
				}
			}
			check('normal: enabled Create default, hover and keyboard-focus text contrast >= 4.5', { results });
		};
		const retainSave = async (response, kind, expectedTitle, expectedDescription) => {
			assert.equal(response.status(), 201);
			const ticket = await response.json();
			assert.equal(ticket.title, expectedTitle);
			assert.equal(ticket.description, expectedDescription);
			assert.equal(ticket.projectId ?? ticket.project, projectKey);
			const retained = await json(`/api/tickets/${encodeURIComponent(projectKey)}/${encodeURIComponent(ticket.id)}`);
			assert.deepEqual(retained, ticket);
			receipt.savedTickets.push({ kind, projectKey, id: ticket.id, ticket });
			check(`${kind}: genuine POST201 and API readback`, { projectKey, id: ticket.id });
		};
		const isCreateResponse = (response) =>
			new URL(response.url()).pathname === '/api/tickets' && response.request().method() === 'POST';
		await openForm();
		if (mode !== 'injected') {
			await page.emulateMedia({ colorScheme: 'light' });
			await createContrast();
			await bounds('normal-390-empty');
			await title().fill('   ');
			await selectProject(projectKey);
			await title().press('Enter');
			await form().getByRole('alert').filter({ hasText: 'more than spaces' }).waitFor();
			assert.equal(postCount, 0, 'Whitespace title does not POST');
			const authoredTitle = `Form first use ${new Date().toISOString()}`;
			const authoredDescription = 'Keyboard capture\nDraft details stay intact.\nAcceptance: readable narrow controls.';
			await title().fill(authoredTitle);
			await create().focus();
			await create().press('Tab');
			assert(await description().evaluate((element) => element.getRootNode().activeElement === element));
			await description().fill(authoredDescription);
			await bounds('normal-390-focused-details');
			await page.setViewportSize({ width: 320, height: 640 });
			await bounds('normal-320-reflow');
			await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
			await bounds('normal-320-dark');
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.emulateMedia({ colorScheme: 'light' });
			await bounds('normal-desktop');
			await description().press('Shift+Tab');
			const response = page.waitForResponse(isCreateResponse);
			await page.keyboard.press('Enter');
			await retainSave(await response, 'normal', authoredTitle, authoredDescription);
			assert.equal(postCount, 1);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.getByText(authoredTitle, { exact: true }).first().waitFor();
			check('normal: saved title visible after actual page reload');
			await openForm();
		}
		if (mode !== 'normal') {
			await page.setViewportSize({ width: 390, height: 844 });
			const draftTitle = `Recover draft ${new Date().toISOString()}`;
			const draftDescription = 'Injected pre-write failure\nThis multiline draft must survive.';
			await title().fill(draftTitle);
			await selectProject(projectKey);
			await description().fill(draftDescription);
			const beforePosts = postCount;
			failureGate = new Promise((done) => {
				releaseFailure = done;
			});
			injectedPost = true;
			receipt.injections.push({
				kind: 'POST /api/tickets',
				behavior: 'Held response, then synthetic 503 before forwarding; retry uses genuine API',
			});
			await title().press('Enter');
			await until(() => heldPost, Boolean, 'held injected save');
			assert.deepEqual(heldBody, { project: projectKey, title: draftTitle, description: draftDescription });
			await form().getByRole('button', { name: 'Creating…', exact: true }).waitFor();
			assert(await form().getByRole('button', { name: 'Creating…', exact: true }).isDisabled());
			assert.equal(await title().getAttribute('readonly'), '');
			assert.equal(await description().getAttribute('readonly'), '');
			assert.equal(await form().getByRole('form', { name: 'Create ticket' }).getAttribute('aria-busy'), 'true');
			// Direct submit events deliberately bypass native disabled-button protection.
			await form().evaluate((host) => {
				for (let i = 0; i < 3; i += 1)
					host.shadowRoot
						.querySelector('form')
						.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
			});
			await delay(120);
			assert.equal(postCount, beforePosts + 1, 'In-flight form accepts only one submission');
			await bounds('injected-save-pending-390');
			releaseFailure();
			await form().getByRole('alert').filter({ hasText: 'Injected pre-write save failure' }).waitFor();
			injectedPost = false;
			assert.equal(await title().inputValue(), draftTitle);
			assert.equal(await description().inputValue(), draftDescription);
			await until(
				() => title().evaluate((element) => element.getRootNode().activeElement === element),
				Boolean,
				'failed save restores title focus',
			);
			await bounds('injected-save-failed-390');
			const response = page.waitForResponse(isCreateResponse);
			await title().press('Enter');
			await retainSave(await response, 'recovery-after-injected-failure', draftTitle, draftDescription);
			assert.equal(postCount, beforePosts + 2);
			check('injected: delayed failure keeps draft, blocks duplicate submit and retries once');
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.getByText(draftTitle, { exact: true }).first().waitFor();
			await openForm();
			// Mount the registered product component with a visibly labelled, isolated
			// client fixture. No metadata below is sent to the daemon or saved there.
			receipt.injections.push({
				kind: 'component client fixture',
				behavior:
					'Deferred/rejected metadata, duplicate names, unavailable project, empty projects and late response; all creates reject locally',
			});
			await page.evaluate(() => {
				const host = document.createElement('ay-ticket-form');
				const projects = [
					{
						id: 'fixture-unavailable',
						name: 'Unavailable fixture',
						unavailable: 'Injected missing folder',
						repoPath: '/fixture/missing',
					},
					{ id: 'fixture-a', name: 'Same fixture name', repoPath: '/fixture/a' },
					{ id: 'fixture-b', name: 'Same fixture name', repoPath: '/fixture/b' },
				];
				const state = { host, projects, metaCalls: 0, creates: [] };
				window.__ticketsFormProof = state;
				host.client = {
					meta() {
						state.metaCalls += 1;
						return state.metaCalls === 1
							? new Promise((resolve, reject) => {
									state.resolve = resolve;
									state.reject = reject;
								})
							: Promise.resolve({ projects });
					},
					async create(...args) {
						state.creates.push(args);
						throw new Error('Injected component-only save rejection');
					},
				};
				const label = document.createElement('p');
				label.textContent = 'Injected component fixture: synthetic projects and failures; no server writes.';
				document.querySelector('#app').replaceChildren(label, host);
			});
			await title().waitFor();
			await title().fill('Draft while projects load');
			await description().fill('Preserve me across metadata retry.');
			assert(await create().isDisabled());
			await form().getByRole('status').filter({ hasText: 'Loading projects' }).waitFor();
			await bounds('injected-projects-loading');
			await page.evaluate(() => window.__ticketsFormProof.reject(new Error('Injected metadata unavailable')));
			const retry = form().getByRole('button', { name: 'Retry projects', exact: true });
			await retry.waitFor();
			await retry.focus();
			await retry.press('Enter');
			const select = form().getByRole('combobox', { name: 'Project' });
			await until(() => select.isEnabled(), Boolean, 'metadata retry succeeds');
			assert.equal(await title().inputValue(), 'Draft while projects load');
			assert.equal(await description().inputValue(), 'Preserve me across metadata retry.');
			assert(await select.evaluate((element) => element.getRootNode().activeElement === element));
			const choices = await select.locator('option').evaluateAll((elements) =>
				elements.map((element) => ({
					value: element.value,
					label: element.textContent.trim(),
					disabled: element.disabled,
				})),
			);
			assert(choices.find((choice) => choice.value === 'fixture-unavailable').disabled);
			assert(choices.find((choice) => choice.value === 'fixture-a').label.includes('fixture-a'));
			assert(choices.find((choice) => choice.value === 'fixture-b').label.includes('fixture-b'));
			await select.press('Home');
			await select.press('ArrowDown');
			await select.press('ArrowDown');
			await select.press('Tab');
			assert.equal(await select.inputValue(), 'fixture-b');
			await title().press('Enter');
			await form().getByRole('alert').filter({ hasText: 'Injected component-only save rejection' }).waitFor();
			assert.deepEqual(await page.evaluate(() => window.__ticketsFormProof.creates), [
				['fixture-b', 'Draft while projects load', 'Preserve me across metadata retry.'],
			]);
			await bounds('injected-duplicate-selection-failed-draft');
			check(
				'injected: project retry preserves draft; duplicate labels distinguish stable IDs; unavailable choice disabled',
				{ choices },
			);
			await page.evaluate(async () => {
				const state = window.__ticketsFormProof;
				state.host.client = {
					meta: () =>
						new Promise((done) => {
							state.late = done;
						}),
				};
				await state.host.updateComplete;
				state.host.client = {
					meta: async () => ({
						projects: [{ id: 'current-fixture', name: 'Current fixture', repoPath: '/fixture/current' }],
					}),
				};
				await state.host.updateComplete;
				state.late({ projects: [{ id: 'stale-fixture', name: 'Stale fixture', repoPath: '/fixture/stale' }] });
			});
			await until(
				() => select.locator('option').allTextContents(),
				(labels) => labels.some((label) => label.includes('Current fixture')),
				'new client metadata',
			);
			assert(!(await select.locator('option').allTextContents()).some((label) => label.includes('Stale fixture')));
			await page.evaluate(() => {
				window.__ticketsFormProof.host.client = { meta: async () => ({ projects: [] }) };
			});
			await form().getByRole('status').filter({ hasText: 'No available projects' }).waitFor();
			assert(await create().isDisabled());
			assert.equal(await title().inputValue(), 'Draft while projects load');
			await bounds('injected-projects-empty');
			check('injected: late metadata rejected; empty state disables save and retains draft');
			await page.evaluate(() => {
				const state = window.__ticketsFormProof;
				state.fixedMetaCalls = 0;
				state.host.project = 'fixed-fixture-id';
				state.host.client = {
					async meta() {
						state.fixedMetaCalls += 1;
						throw new Error('Fixed form must not need global metadata');
					},
					async create(...args) {
						state.creates.push(args);
						throw new Error('Injected fixed-project save failure');
					},
				};
			});
			await until(() => create().isEnabled(), Boolean, 'fixed-project form usable without metadata');
			assert.equal(await select.count(), 0);
			await title().press('Enter');
			await form().getByRole('alert').filter({ hasText: 'Injected fixed-project save failure' }).waitFor();
			assert.equal(await page.evaluate(() => window.__ticketsFormProof.fixedMetaCalls), 0);
			assert.equal(await page.evaluate(() => window.__ticketsFormProof.creates.at(-1)[0]), 'fixed-fixture-id');
			assert.equal(await description().inputValue(), 'Preserve me across metadata retry.');
			await page.setViewportSize({ width: 320, height: 640 });
			await bounds('injected-fixed-project-320');
			check('injected: fixed project skips metadata and preserves draft on failure');
		}
		const final = await json('/api/tickets');
		assert.equal(
			final.tickets.length,
			initial.tickets.length + receipt.savedTickets.length,
			'Only expected genuine saves persisted',
		);
		assert.deepEqual(receipt.pageErrors, []);
		await Promise.all(assetWork);
		assert.deepEqual(receipt.assetErrors, [], 'Runtime asset identity captured');
		receipt.passed = true;
	} catch (error) {
		receipt.passed = false;
		receipt.error = error.stack ?? String(error);
	} finally {
		releaseFailure?.();
		const cleanupErrors = [];
		if (context) {
			try {
				await context.tracing.stop({ path: join(outputDir, 'trace.zip') });
			} catch (error) {
				cleanupErrors.push(String(error));
			}
			try {
				await context.close();
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
		if (browser && !options.browser) {
			try {
				await browser.close();
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
		if (slot) {
			try {
				await slot.close();
				await unlink(slotPath);
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
		receipt.cleanupErrors = cleanupErrors;
		if (cleanupErrors.length) receipt.passed = false;
		receipt.finishedAt = new Date().toISOString();
		await writeFile(join(outputDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
	}
	if (!receipt.passed)
		throw Object.assign(
			new Error(
				`Form proof failed; ${join(outputDir, 'receipt.json')}: ${receipt.error ?? receipt.cleanupErrors.join('; ')}`,
			),
			{ receipt },
		);
	return receipt;
}

/** Adapter for main's installed-package startup / UI / restart composition. */
export function runFormProof({ base, output, ...options }) {
	return runFormFirstUseProof(base, {
		fixtureLabel: 'Main-supplied isolated installed Tickets package',
		outputDir: output,
		...options,
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = new Map();
	for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
	if (!args.get('--url') || !args.get('--fixture-label')) {
		console.log(
			'Usage: node form-first-use-proof.mjs --url <isolated-loopback-url> --fixture-label <identity> [--mode all|normal|injected] [--output <dir>] [--playwright <index.mjs>] [--project <stable-key>] [--browser-slot <lock-file>]',
		);
		process.exitCode = args.has('--help') ? 0 : 1;
	} else {
		try {
			const receipt = await runFormFirstUseProof(args.get('--url'), {
				fixtureLabel: args.get('--fixture-label'),
				mode: args.get('--mode'),
				outputDir: args.get('--output'),
				playwrightPath: args.get('--playwright'),
				projectKey: args.get('--project'),
				browserSlotPath: args.get('--browser-slot'),
			});
			console.log(
				JSON.stringify(
					{
						passed: receipt.passed,
						outputDir: receipt.outputDir,
						checks: receipt.checks.length,
						savedTickets: receipt.savedTickets,
					},
					null,
					2,
				),
			);
		} catch (error) {
			console.error(error.message);
			process.exitCode = 1;
		}
	}
}
