import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STATUSES } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from '../app';
import { createContext } from '../context';
import { buildLaunchCommand } from '../launch';
import { DEFAULT_TERMINALS } from '../registry';
import type { DaemonConfig } from '../types/DaemonConfig';

let dataDir: string;
let app: Hono;
let launchedCommands: string[];

const buildConfig = (): DaemonConfig => ({
	port: 0,
	apiBase: 'https://tickets.lvh.me/api',
	statuses: [...DEFAULT_STATUSES],
	projects: [{ name: 'demo', repoPath: '/tmp/repos/demo', adapter: 'folder', dataDir }],
	terminals: DEFAULT_TERMINALS,
	enrich: { defaultProvider: 'claude-cli', providers: [{ id: 'claude-cli', kind: 'claude-cli' }] },
});

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'tickets-launch-test-'));
	launchedCommands = [];
	app = createApp(createContext(buildConfig(), { runCommand: (command) => launchedCommands.push(command) }));
	await app.request('/api/tickets', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ project: 'demo', title: 'Launch me' }),
	});
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

describe('buildLaunchCommand', () => {
	test('substitutes $REPO and $PROMPT_URL, leaves host-shell vars alone', () => {
		const command = buildLaunchCommand('wt.exe -d "$WSL_DISTRO_NAME" --cd "$REPO" -- curl "$PROMPT_URL"', {
			repoPath: '/home/user/projects/demo',
			promptUrl: 'https://tickets.lvh.me/api/tickets/demo/0001/prompt',
		});
		expect(command).toBe(
			'wt.exe -d "$WSL_DISTRO_NAME" --cd "/home/user/projects/demo" -- curl "https://tickets.lvh.me/api/tickets/demo/0001/prompt"',
		);
	});
});

describe('POST /api/tickets/:project/:id/launch', () => {
	test('runs the default terminal command and transitions to in_progress', async () => {
		const response = await app.request('/api/tickets/demo/0001/launch', { method: 'POST' });
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.launched).toBe(true);
		expect(payload.terminal).toBe('wt');
		expect(payload.ticket.status).toBe('in_progress');

		expect(launchedCommands.length).toBe(1);
		expect(launchedCommands[0]).toContain('wt.exe');
		expect(launchedCommands[0]).toContain('--cd "/tmp/repos/demo"');
		expect(launchedCommands[0]).toContain('https://tickets.lvh.me/api/tickets/demo/0001/prompt');
		expect(launchedCommands[0]).not.toContain('$REPO');
		expect(launchedCommands[0]).not.toContain('$PROMPT_URL');
	});

	test('honors an explicit terminal id', async () => {
		const response = await app.request('/api/tickets/demo/0001/launch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ terminal: 'tabby' }),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).terminal).toBe('tabby');
		expect(launchedCommands[0]).toContain('Tabby.exe');
	});

	test('rejects unknown terminals and missing tickets', async () => {
		const badTerminal = await app.request('/api/tickets/demo/0001/launch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ terminal: 'kitty' }),
		});
		expect(badTerminal.status).toBe(400);
		expect(launchedCommands.length).toBe(0);

		const missing = await app.request('/api/tickets/demo/0404/launch', { method: 'POST' });
		expect(missing.status).toBe(404);
	});

	test('an already in_progress ticket stays in_progress without a second transition', async () => {
		await app.request('/api/tickets/demo/0001/launch', { method: 'POST' });
		const second = await app.request('/api/tickets/demo/0001/launch', { method: 'POST' });
		const payload = await second.json();
		expect(payload.ticket.status).toBe('in_progress');
		expect(launchedCommands.length).toBe(2);
	});
});
