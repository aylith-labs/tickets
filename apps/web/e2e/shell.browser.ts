import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.route('**/*', (route) => {
		const origin = new URL(route.request().url()).origin;
		return ['http://127.0.0.1:5184', 'http://127.0.0.1:5185'].includes(origin) ? route.continue() : route.abort();
	});
});
const nav = (page: Page) => page.getByRole('navigation', { name: 'Product navigation', exact: true });
async function mounted(page: Page, path = '/synthetic-stable-01') {
	await page.goto(path);
	await expect(page.getByRole('button', { name: 'Use native navigation', exact: true })).toBeVisible();
	await expect(page.locator('ay-ticket-list')).toBeVisible();
}
async function wrapRemote(page: Page, body: string) {
	await page.route(/\/remoteEntry\.js$/, (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			body: `
	 import {get as originalGet} from './remoteEntry.js?original=1'; export {init} from './remoteEntry.js?original=1';
	 export async function get(...args){const factory=await originalGet(...args);return ()=>{const module=factory();const remote=module.default??module;
	 return {contractVersion:remote.contractVersion,mount:async(target,context)=>{${body}}};};}`,
		}),
	);
}

test('real folder storage: stable route creates a ticket, reloads it and receives SSE updates', async ({ page }) => {
	await mounted(page);
	await expect(nav(page).getByRole('link', { name: 'Renamed synthetic project', exact: true })).toHaveAttribute(
		'aria-current',
		'page',
	);
	await expect(
		page.locator('#projects').getByRole('link', { name: 'Renamed synthetic project', exact: true }),
	).toHaveAttribute('href', '/synthetic-stable-01');
	const title = 'SYNTHETIC shell folder persistence';
	await page.getByPlaceholder('What needs fixing or building?').fill(title);
	await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
	await expect(page.locator('ay-ticket-card')).toContainText(title);
	const meta = await (await page.request.get('/api/projects')).json();
	const root = resolve(meta.storeRoots.store);
	expect(root.startsWith(resolve(tmpdir()) + sep)).toBe(true);
	expect(root).toContain('aylith-tickets-shell-');
	const { tickets } = await (await page.request.get('/api/tickets?project=synthetic-stable-01')).json();
	const stored = tickets.find((ticket: { title: string }) => ticket.title === title);
	expect(stored.projectId).toBe('synthetic-stable-01');
	expect(await readFile(join(root, 'tickets', `${stored.id}.md`), 'utf8')).toContain(title);
	await page.reload();
	await expect(page.locator('ay-ticket-card')).toContainText(title);
	const update = await page.request.post('/api/tickets', {
		data: { project: 'synthetic-stable-01', title: 'SYNTHETIC SSE delivery' },
	});
	expect(update.status()).toBe(201);
	await expect(page.locator('ay-ticket-card').filter({ hasText: 'SYNTHETIC SSE delivery' })).toBeVisible();
	await nav(page).getByRole('link', { name: 'All projects', exact: true }).click();
	await expect(page).toHaveURL('http://127.0.0.1:5184/');
	await expect(nav(page).getByRole('link', { name: 'All projects', exact: true })).toHaveAttribute(
		'aria-current',
		'page',
	);
	await page.goBack();
	await expect(nav(page).getByRole('link', { name: 'Renamed synthetic project', exact: true })).toHaveAttribute(
		'aria-current',
		'page',
	);
});

test('legacy, malformed and unknown route semantics remain intact with optional shell', async ({ page }) => {
	await mounted(page, '/Renamed%20synthetic%20project?view=board#review');
	await expect(page).toHaveURL(/\/synthetic-stable-01\?view=board#review$/);
	for (const [path, message] of [
		['/%E0%A4%A', 'Invalid project URL'],
		['/does-not-exist', 'Project not found'],
	]) {
		await page.goto(path ?? '/');
		await expect(page.locator('#app').getByRole('alert')).toContainText(message ?? '');
		await expect(page.locator('ay-ticket-list')).toHaveCount(0);
		await page.locator('#app').getByRole('link', { name: 'All projects', exact: true }).click();
		await expect(page.locator('ay-ticket-list')).toBeVisible();
	}
});

test('unconnected preferences and product homes do not invent shared identity', async ({ page }) => {
	await wrapRemote(
		page,
		`globalThis.identityFixture={user:context.user,project:context.project,products:context.products};return remote.mount(target,context);`,
	);
	await mounted(page);
	expect(await page.evaluate('JSON.stringify(globalThis.identityFixture)')).toBe(
		JSON.stringify({ products: [{ id: 'tickets', name: 'Tickets', href: 'http://127.0.0.1:5184' }] }),
	);
	await page.getByRole('button', { name: 'Customize shell', exact: true }).click();
	await expect(
		page.getByText('Shared preferences require a verified account connection.', { exact: false }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
	await page.keyboard.press('Escape');
});

for (const kind of ['manifest', 'execution', 'stalled'] as const) {
	test(`${kind} failure leaves real native creation and routing available`, async ({ page }) => {
		if (kind === 'manifest')
			await page.route('**/mf-manifest.json', (route) => route.fulfill({ status: 404, body: 'Fixture outage' }));
		else
			await page.route(/\/remoteEntry\.js$/, (route) =>
				route.fulfill({
					contentType: 'text/javascript',
					body:
						kind === 'execution'
							? "throw new Error('Synthetic execution failure')"
							: 'export const init=()=>{};export const get=async()=>()=>({contractVersion:1,mount:()=>new Promise(()=>{})});',
				}),
			);
		await page.goto('/synthetic-stable-01');
		await expect(
			page.getByText('Shared navigation unavailable. Native project navigation remains available.'),
		).toBeVisible({ timeout: 12_000 });
		await page.getByRole('button', { name: 'New ticket', exact: true }).click();
		await page.getByPlaceholder('What needs fixing or building?').fill(`SYNTHETIC ${kind} fallback`);
		await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
		await expect(page.locator('ay-ticket-card').filter({ hasText: `SYNTHETIC ${kind} fallback` })).toBeVisible();
		await page.locator('#projects').getByRole('link', { name: 'all', exact: true }).click();
		await expect(page.locator('ay-ticket-list')).toBeVisible();
	});
}

for (const settle of ['resolve', 'reject'] as const) {
	test(`stale callbacks and late ${settle} cannot damage a retry`, async ({ page }) => {
		await page.route(/\/remoteEntry\.js$/, (route) =>
			route.fulfill({
				contentType: 'text/javascript',
				body: `
		let calls=0;export const init=()=>{};export const get=async()=>()=>({contractVersion:1,mount:async(target,context)=>{
		 if(++calls===1){globalThis.oldError=()=>context.onEvent({type:'error',source:'remote',message:'stale fixture'});queueMicrotask(globalThis.oldError);
		 return new Promise((resolve,reject)=>{globalThis.finishOld=()=>${settle === 'reject' ? "reject(new Error('late fixture'))" : 'resolve({update(){},unmount(){target.replaceChildren();globalThis.oldDisposed=true;}})'};});}
		 target.textContent='Replacement shell fixture';return {update(){},unmount(){target.replaceChildren();}};}});`,
			}),
		);
		await page.goto('/synthetic-stable-01');
		await expect(page.getByRole('button', { name: 'Retry shared navigation' })).toBeEnabled();
		await page.getByRole('button', { name: 'Retry shared navigation' }).click();
		await expect(page.getByText('Replacement shell fixture')).toBeVisible();
		await page.evaluate('globalThis.oldError();globalThis.finishOld()');
		await expect(page.getByText('Replacement shell fixture')).toBeVisible();
		if (settle === 'resolve') await expect.poll(() => page.evaluate('globalThis.oldDisposed')).toBe(true);
		await expect(page.locator('ay-ticket-list')).toBeVisible();
	});
}

test('real initial and post-mount render errors recover without losing ticket form', async ({ page }) => {
	await wrapRemote(
		page,
		`globalThis.mountCount=(globalThis.mountCount||0)+1;
	 const handle=await remote.mount(target,globalThis.mountCount===1?{...context,app:{id:'tickets',name:null}}:context);
	 globalThis.breakShell=()=>handle.update({app:{id:'tickets',name:null}});return handle;`,
	);
	await page.goto('/synthetic-stable-01');
	await expect(
		page.getByText('Shared navigation unavailable. Native project navigation remains available.'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Retry shared navigation' }).click();
	await expect(page.locator('.aylith-shell')).toHaveCount(1);
	await page.getByRole('button', { name: 'New ticket', exact: true }).click();
	await page.getByPlaceholder('What needs fixing or building?').fill('Draft survives render failure');
	await page.evaluate('globalThis.breakShell()');
	await expect(page.locator('.aylith-shell')).toHaveCount(0);
	await expect(page.getByPlaceholder('What needs fixing or building?')).toHaveValue('Draft survives render failure');
	await page.getByRole('button', { name: 'Retry shared navigation' }).click();
	await expect(page.locator('.aylith-shell')).toHaveCount(1);
	await expect(page.getByPlaceholder('What needs fixing or building?')).toHaveValue('Draft survives render failure');
});

test('host theme, previews, narrow dialogs and repeated cleanup stay coherent', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('ay-theme', 'dark'));
	await mounted(page);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('button', { name: 'Customize shell', exact: true }).click();
	await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
	await page.keyboard.press('Escape');
	for (let i = 0; i < 2; i++) {
		await page.getByRole('button', { name: 'Use native navigation', exact: true }).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--aylith-accent'))).toBe('');
		await page.getByRole('button', { name: 'Retry shared navigation' }).click();
		await expect(page.locator('.aylith-shell')).toHaveCount(1);
	}
	await page.setViewportSize({ width: 820, height: 900 });
	const appBox = await page.locator('#app').boundingBox();
	expect(appBox?.x).toBeGreaterThanOrEqual(272);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
	await page.getByRole('button', { name: 'Switch product', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Switch product' });
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Tab');
		expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Switch product', exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible();
});

test('disabled opt-in and untrusted manifest keep native routes without remote requests', async ({ page }) => {
	const remotes: string[] = [];
	page.on('request', (req) => {
		if (new URL(req.url()).port === '5185') remotes.push(req.url());
	});
	const fixtureRoute = /^http:\/\/127\.0\.0\.1:5184\/synthetic-stable-01(?:\?.*)?$/;
	await page.route(fixtureRoute, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: (await response.text()).replace(
				'name="aylith-shell-enabled" content="true"',
				'name="aylith-shell-enabled" content="false"',
			),
		});
	});
	await page.goto('/synthetic-stable-01?manifest=https://untrusted.invalid/mf-manifest.json');
	await expect(page.locator('ay-ticket-list')).toBeVisible();
	await expect(page.locator('#shell-controls')).toBeHidden();
	expect(remotes).toEqual([]);
	await page.unroute(fixtureRoute);
	await page.route('http://127.0.0.1:5184/synthetic-stable-01', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: (await response.text()).replace(
				'content="http://127.0.0.1:5185/mf-manifest.json"',
				'content="https://untrusted.invalid/mf-manifest.json"',
			),
		});
	});
	await page.goto('/synthetic-stable-01');
	await expect(page.getByText('Shared navigation is not configured for this host.', { exact: false })).toBeVisible();
	expect(remotes).toEqual([]);
});
