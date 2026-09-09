import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { allowsLocalRequest } from '../local-request';
import { writeDaemonConfig } from '../registry';
import { startDaemon } from '../serve';
import { writeMarker } from '../store-marker';

let root: string;
let configPath: string;
let dataDir: string;
let savedConfig: string;
let server: Awaited<ReturnType<typeof startDaemon>> | undefined;
let base: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'tickets-local-request-'));
	dataDir = join(root, 'selected');
	configPath = join(root, 'config.json');
	await mkdir(join(dataDir, 'tickets'), { recursive: true });
	await writeMarker(dataDir, {
		schemaVersion: 1,
		id: 'selected',
		name: 'Selected fixture',
		kind: 'folder',
		createdAt: '2026-09-08T00:00:00Z',
	});
	await writeDaemonConfig(
		{
			port: 6320,
			apiBase: '/api',
			statuses: ['todo', 'done'],
			storeRoot: join(root, 'unused-store'),
			worktreesRoot: join(root, 'unused-worktrees'),
			projects: [
				{
					id: 'selected',
					name: 'Selected fixture',
					repoPath: dataDir,
					location: { kind: 'folder', scope: 'repo', dataDir },
				},
			],
			terminals: [],
			enrich: { defaultProvider: '', providers: [] },
		},
		configPath,
	);
	savedConfig = await readFile(configPath, 'utf8');
	server = await startDaemon({ configPath, local: true, projectIds: ['selected'], port: 0 });
	base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
	server?.stopWatching();
	await server?.stop(true);
	server = undefined;
	if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('tickets-local-request-')) {
		throw new Error('Refusing cleanup outside the test temporary directory');
	}
	await rm(root, { recursive: true, force: true });
});

const create = (headers: Record<string, string> = {}) =>
	fetch(`${base}/api/tickets`, {
		method: 'POST',
		headers: { 'content-type': 'text/plain', ...headers },
		body: JSON.stringify({ project: 'selected', title: 'Boundary fixture' }),
	});

describe('local daemon request boundary on the actual listener', () => {
	test('an unknown listener port or mismatched request URL cannot grant access', () => {
		const request = new Request(base, { headers: { host: new URL(base).host } });
		for (const port of [undefined, 0, -1, 65536, 1.5, Number.NaN])
			expect(allowsLocalRequest(request, port)).toBe(false);
		for (const url of ['https://127.0.0.1:6320', 'http://localhost:1', 'http://127.0.0.1.evil.invalid:6320']) {
			expect(allowsLocalRequest(new Request(url, { headers: { host: new URL(url).host } }), 6320)).toBe(false);
		}
	});
	test('a foreign simple POST is denied before a record is created', async () => {
		const response = await create({ origin: 'https://outside.invalid', 'sec-fetch-site': 'cross-site' });
		expect(response.status).toBe(403);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(await readdir(join(dataDir, 'tickets'))).toEqual([]);
		expect(await readFile(configPath, 'utf8')).toBe(savedConfig);
	});

	test('same-origin browser and origin-less native requests still persist', async () => {
		const first = await create({ origin: base, 'sec-fetch-site': 'same-origin' });
		expect(first.status).toBe(201);
		const created = await first.json();
		expect(created.projectId).toBe('selected');
		expect((await create()).status).toBe(201);
		expect(await readdir(join(dataDir, 'tickets'))).toHaveLength(2);
		expect(await readFile(configPath, 'utf8')).toBe(savedConfig);
	});

	test('a sibling local app is not the same origin and cannot read or write', async () => {
		for (const origin of [
			'http://127.0.0.1:1',
			'https://venture.lvh.me',
			'http://tickets.lvh.me',
			'null',
			`${base}/path`,
		]) {
			const headers = { origin, 'sec-fetch-site': 'same-site' };
			expect((await create(headers)).status).toBe(403);
			expect((await fetch(`${base}/api/projects`, { headers })).status).toBe(403);
		}
		expect(await readdir(join(dataDir, 'tickets'))).toEqual([]);
	});

	test('opaque, inconsistent and unknown fetch metadata fail closed', async () => {
		for (const site of ['cross-site', 'same-site', 'none', 'surprise']) {
			expect((await create({ origin: base, 'sec-fetch-site': site })).status).toBe(403);
		}
		expect((await create({ origin: '' })).status).toBe(403);
		expect((await fetch(`${base}/api/projects`, { headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
		expect(await readdir(join(dataDir, 'tickets'))).toEqual([]);
	});

	test('untrusted Host and spoofed forwarded headers cannot widen the listener', async () => {
		for (const host of ['outside.invalid', 'tickets.lvh.me', '127.0.0.1:1']) {
			const response = await create({
				host,
				'x-forwarded-host': `127.0.0.1:${server?.port}`,
				'x-forwarded-proto': 'http',
			});
			expect(response.status).toBe(403);
		}
		expect(await readdir(join(dataDir, 'tickets'))).toEqual([]);
	});

	test('a rejected preflight or other method never reaches protected routes', async () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE']) {
			const response = await fetch(`${base}/api/projects`, {
				method,
				headers: { origin: 'https://outside.invalid', 'access-control-request-method': 'POST' },
			});
			expect(response.status).toBe(403);
			expect(response.headers.get('access-control-allow-origin')).toBeNull();
		}
	});

	test('cross-app document navigation opens the UI, not the API or an iframe', async () => {
		const headers = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
		const page = await fetch(`${base}/?project=selected`, { headers });
		expect(page.status).toBe(200);
		expect(page.headers.get('content-type')).toContain('text/html');
		expect((await fetch(`${base}/api/projects`, { headers })).status).toBe(403);
		for (const path of ['/%61pi/projects', '/a%70i/projects', '/api%2Fprojects', '/%61pi/events']) {
			expect((await fetch(`${base}${path}`, { headers })).status).toBe(403);
		}
		expect((await fetch(base, { headers: { ...headers, 'sec-fetch-dest': 'iframe' } })).status).toBe(403);
		expect((await fetch(base, { headers: { ...headers, origin: 'https://outside.invalid' } })).status).toBe(403);
	});
});
