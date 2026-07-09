import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STATUSES, exec } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from '../app';
import { createContext } from '../context';
import { extractEnrichResult } from '../enrich/json';
import { buildEnrichPrompt } from '../enrich/prompt';
import { DEFAULT_TERMINALS } from '../registry';
import type { DaemonConfig } from '../types/DaemonConfig';

describe('extractEnrichResult', () => {
	const expected = { title: 'Fix the thing', description: 'It is broken.' };

	test('parses direct JSON', () => {
		expect(extractEnrichResult(JSON.stringify(expected))).toEqual(expected);
	});

	test('parses fenced JSON with prose around it', () => {
		const text = `Here you go:\n\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`\nHope that helps!`;
		expect(extractEnrichResult(text)).toEqual(expected);
	});

	test('parses a brace span inside prose', () => {
		expect(extractEnrichResult(`Sure! ${JSON.stringify(expected)} — done.`)).toEqual(expected);
	});

	test('rejects garbage and empty titles', () => {
		expect(extractEnrichResult('no json here')).toBeNull();
		expect(extractEnrichResult('{"title": "", "description": "x"}')).toBeNull();
		expect(extractEnrichResult('{"title": 42, "description": "x"}')).toBeNull();
	});
});

describe('buildEnrichPrompt', () => {
	test('embeds title and description', () => {
		const prompt = buildEnrichPrompt({
			id: '0001',
			title: 'fix stuff',
			status: 'todo',
			archived: false,
			created: '2026-07-09T00:00:00.000Z',
			attachments: [],
			description: 'the thing breaks',
		});
		expect(prompt).toContain('fix stuff');
		expect(prompt).toContain('the thing breaks');
		expect(prompt).toContain('JSON');
	});
});

describe('POST /api/tickets/:project/:id/enrich', () => {
	let dataDir: string;
	let app: Hono;

	const buildConfig = (): DaemonConfig => ({
		port: 0,
		apiBase: 'https://tickets.lvh.me/api',
		statuses: [...DEFAULT_STATUSES],
		projects: [{ name: 'demo', repoPath: '/tmp/repos/demo', adapter: 'git', dataDir }],
		terminals: DEFAULT_TERMINALS,
		enrich: {
			defaultProvider: 'claude-cli',
			providers: [
				{ id: 'claude-cli', kind: 'claude-cli' },
				{ id: 'broken', kind: 'anthropic' },
			],
		},
	});

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'tickets-enrich-test-'));
		await exec('git', ['init', '-b', 'tickets'], dataDir);
		await exec('git', ['config', 'user.email', 'tickets@test.local'], dataDir);
		await exec('git', ['config', 'user.name', 'Tickets Test'], dataDir);
		// The git adapter would push after each mutation; disable by leaving no origin (push is best-effort).
		app = createApp(
			createContext(buildConfig(), {
				enrich: async (ticket, provider) => {
					if (provider.id === 'broken') throw new Error('provider exploded');
					return { title: `Enriched: ${ticket.title}`, description: `## Context\n\n${ticket.description}` };
				},
			}),
		);
		await app.request('/api/tickets', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: 'demo', title: 'fix stuff', description: 'the thing breaks' }),
		});
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	test('enriches, records a revision, and undo restores the original', async () => {
		const enrichResponse = await app.request('/api/tickets/demo/0001/enrich', { method: 'POST' });
		expect(enrichResponse.status).toBe(200);
		const enriched = await enrichResponse.json();
		expect(enriched.title).toBe('Enriched: fix stuff');

		const revisions = (await (await app.request('/api/tickets/demo/0001/revisions')).json()).revisions;
		expect(revisions.length).toBe(2);
		expect(revisions[0].message).toBe('Enrich ticket 0001');

		const restoreResponse = await app.request(`/api/tickets/demo/0001/revisions/${revisions[1].ref}/restore`, {
			method: 'POST',
		});
		expect(restoreResponse.status).toBe(200);
		const restored = await restoreResponse.json();
		expect(restored.title).toBe('fix stuff');
		expect(restored.description).toBe('the thing breaks');
	});

	test('unknown provider is a 400, provider failure a 502 leaving the ticket untouched', async () => {
		const unknown = await app.request('/api/tickets/demo/0001/enrich', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'nope' }),
		});
		expect(unknown.status).toBe(400);

		const failing = await app.request('/api/tickets/demo/0001/enrich', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider: 'broken' }),
		});
		expect(failing.status).toBe(502);

		const ticket = await (await app.request('/api/tickets/demo/0001')).json();
		expect(ticket.title).toBe('fix stuff');
	});
});
