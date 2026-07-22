import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STATUSES } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from '../app';
import { createContext } from '../context';
import { DEFAULT_TERMINALS } from '../registry';
import type { DaemonConfig } from '../types/DaemonConfig';

let dataDir: string;
let app: Hono;
let hookFile: string;

const buildConfig = (): DaemonConfig => ({
	port: 0,
	apiBase: 'https://tickets.lvh.me/api',
	statuses: [...DEFAULT_STATUSES],
	storeRoot: dataDir,
	worktreesRoot: dataDir,
	projects: [{ id: 'demo00000001', name: 'demo', repoPath: '/tmp/repos/demo', adapter: 'folder', dataDir }],
	terminals: DEFAULT_TERMINALS,
	enrich: { defaultProvider: 'claude-cli', providers: [{ id: 'claude-cli', kind: 'claude-cli' }] },
	onStatusChange: `printf '%s %s %s' "$TICKET_ID" "$OLD_STATUS" "$NEW_STATUS" > ${'$'}{HOOK_FILE}`,
});

const jsonRequest = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return false;
};

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'tickets-server-test-'));
	hookFile = join(dataDir, 'hook-output.txt');
	process.env.HOOK_FILE = hookFile;
	app = createApp(createContext(buildConfig()));
});

afterEach(async () => {
	delete process.env.HOOK_FILE;
	await rm(dataDir, { recursive: true, force: true });
});

describe('tickets API', () => {
	test('GET /api/projects exposes registry, statuses, and terminal labels', async () => {
		const response = await app.request('/api/projects');
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.projects).toEqual([{ name: 'demo', repoPath: '/tmp/repos/demo', adapter: 'folder' }]);
		expect(payload.statuses).toEqual([...DEFAULT_STATUSES]);
		expect(payload.terminals).toEqual([
			{ id: 'wt', label: 'Windows Terminal' },
			{ id: 'tabby', label: 'Tabby' },
		]);
	});

	test('create → list → get lifecycle', async () => {
		const createResponse = await app.request(
			'/api/tickets',
			jsonRequest('POST', { project: 'demo', title: 'First', description: 'Body.' }),
		);
		expect(createResponse.status).toBe(201);
		const created = await createResponse.json();
		expect(created.id).toBe('0001');
		expect(created.project).toBe('demo');

		const listResponse = await app.request('/api/tickets?project=demo');
		const listed = await listResponse.json();
		expect(listed.tickets.length).toBe(1);
		expect(listed.tickets[0].title).toBe('First');

		const getResponse = await app.request('/api/tickets/demo/0001');
		expect(getResponse.status).toBe(200);
	});

	test('create validates project and title', async () => {
		expect((await app.request('/api/tickets', jsonRequest('POST', { project: 'demo' }))).status).toBe(400);
		expect((await app.request('/api/tickets', jsonRequest('POST', { project: 'nope', title: 'X' }))).status).toBe(404);
	});

	test('PATCH updates fields, validates status, fires the status hook', async () => {
		await app.request('/api/tickets', jsonRequest('POST', { project: 'demo', title: 'Patch me' }));

		const badStatus = await app.request('/api/tickets/demo/0001', jsonRequest('PATCH', { status: 'bogus' }));
		expect(badStatus.status).toBe(400);

		const patched = await app.request('/api/tickets/demo/0001', jsonRequest('PATCH', { status: 'in_progress' }));
		expect(patched.status).toBe(200);
		expect((await patched.json()).status).toBe('in_progress');

		const hookRan = await waitFor(async () => {
			try {
				return (await readFile(hookFile, 'utf8')).length > 0;
			} catch {
				return false;
			}
		});
		expect(hookRan).toBe(true);
		expect(await readFile(hookFile, 'utf8')).toBe('0001 todo in_progress');
	});

	test('archive hides tickets from the default list', async () => {
		await app.request('/api/tickets', jsonRequest('POST', { project: 'demo', title: 'Archive me' }));
		const archiveResponse = await app.request('/api/tickets/demo/0001/archive', { method: 'POST' });
		expect(archiveResponse.status).toBe(200);

		const defaultList = await (await app.request('/api/tickets')).json();
		expect(defaultList.tickets.length).toBe(0);

		const fullList = await (await app.request('/api/tickets?archived=true')).json();
		expect(fullList.tickets.length).toBe(1);
	});

	test('prompt endpoint returns the composed plain-text prompt', async () => {
		await app.request(
			'/api/tickets',
			jsonRequest('POST', { project: 'demo', title: 'Prompt me', description: 'Details.' }),
		);
		const response = await app.request('/api/tickets/demo/0001/prompt');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/plain');
		const prompt = await response.text();
		expect(prompt).toContain('# Prompt me');
		expect(prompt).toContain('Repository: /tmp/repos/demo');
		expect(prompt).toContain('https://tickets.lvh.me/api/tickets/demo/0001');
	});

	test('revisions are empty for the folder adapter and restore fails cleanly', async () => {
		await app.request('/api/tickets', jsonRequest('POST', { project: 'demo', title: 'No history' }));
		const revisions = await (await app.request('/api/tickets/demo/0001/revisions')).json();
		expect(revisions.revisions).toEqual([]);
		const restore = await app.request('/api/tickets/demo/0001/revisions/abc123/restore', { method: 'POST' });
		expect(restore.status).toBe(400);
	});
});
