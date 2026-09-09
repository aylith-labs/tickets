import { describe, expect, test } from 'bun:test';
import type { StorageAdapter, Ticket } from '@aylith/tickets-core';
import type { TicketsMeta } from '@aylith/tickets-core/client';
import { createApp } from '../app';
import type { ServerContext } from '../context';
import { EventBus } from '../events';

// In-memory API fixture: no registry reads, daemon, provider, filesystem or Git work.
const fixture = (media = false, local?: boolean) => {
	let ticket: Ticket = {
		id: '0001',
		title: 'Existing ticket',
		description: 'Existing description',
		status: 'todo',
		archived: false,
		created: '2026-09-08T00:00:00.000Z',
		attachments: [{ url: '/fixture-before.png', kind: 'before', type: 'image', label: 'Existing evidence' }],
	};
	let publishCalls = 0;
	let failUpload = false;
	const unused = async (): Promise<never> => {
		throw new Error('Unexpected fixture operation');
	};
	const adapter: StorageAdapter = {
		list: async () => [ticket],
		get: async (id) => (id === ticket.id ? ticket : null),
		create: unused,
		update: async (id, patch) => {
			expect(id).toBe(ticket.id);
			ticket = { ...ticket, ...patch };
			return ticket;
		},
		archive: unused,
		getRevisions: async () => [],
		getRevision: unused,
		restoreRevision: unused,
	};
	const context: ServerContext = {
		config: {
			port: 0,
			apiBase: 'http://127.0.0.1/api',
			statuses: ['todo', 'done'],
			storeRoot: '/unused-fixture',
			worktreesRoot: '/unused-fixture',
			projects: [
				{
					id: 'fixture-id',
					name: 'Fixture',
					repoPath: '/unused-fixture',
					adapter: 'folder',
					dataDir: '/unused-fixture',
				},
			],
			terminals: [],
			enrich: { defaultProvider: '', providers: [] },
			media: media
				? { repoPath: '/unused-media', baseUrl: 'http://127.0.0.1/media', pathPrefix: 'fixture' }
				: undefined,
		},
		adapters: new Map([['fixture-id', adapter]]),
		events: new EventBus(),
		runCommand: () => {
			throw new Error('Unexpected command');
		},
		enrich: unused,
		publishMedia: async (input) => {
			publishCalls += 1;
			if (failUpload) throw new Error('Fixture upload failed; try again');
			return { url: '/fixture-after.png', kind: input.kind, type: 'image' };
		},
	};
	const app = local === undefined ? createApp(context) : createApp(context, { local });
	return {
		app,
		context,
		published: () => publishCalls,
		setUploadFailure: (value: boolean) => {
			failUpload = value;
		},
	};
};

const attach = (app: ReturnType<typeof createApp>) => {
	const body = new FormData();
	body.append('file', new File(['fixture'], 'after.png', { type: 'image/png' }));
	body.append('kind', 'after');
	return app.request('/api/tickets/fixture-id/0001/attachments', { method: 'POST', body });
};

describe('media upload capabilities', () => {
	for (const mode of [
		{
			name: 'default unconfigured',
			media: false,
			local: undefined,
			expected: { available: false, reason: 'not-configured' },
		},
		{ name: 'default configured', media: true, local: undefined, expected: { available: true } },
		{
			name: 'explicit normal unconfigured',
			media: false,
			local: false,
			expected: { available: false, reason: 'not-configured' },
		},
		{ name: 'explicit normal configured', media: true, local: false, expected: { available: true } },
		{ name: 'local unconfigured', media: false, local: true, expected: { available: false, reason: 'local-mode' } },
		{
			name: 'local takes precedence over media config',
			media: true,
			local: true,
			expected: { available: false, reason: 'local-mode' },
		},
	] as const) {
		test(mode.name, async () => {
			const { app, published } = fixture(mode.media, mode.local);
			const response = await app.request('/api/projects');
			expect(response.status).toBe(200);
			const meta = (await response.json()) as TicketsMeta;
			expect(meta.capabilities?.mediaUpload).toEqual(mode.expected);
			expect(published()).toBe(0);
			expect(JSON.stringify(meta)).not.toContain('/unused-media');
		});
	}

	test('reports current in-memory media configuration without exposing provider details', async () => {
		const { app, context } = fixture(true);
		context.config.media = undefined;
		expect((await (await app.request('/api/projects')).json()).capabilities.mediaUpload).toEqual({
			available: false,
			reason: 'not-configured',
		});
	});

	for (const local of [false, true]) {
		test(`unconfigured ${local ? 'local' : 'normal'} mode retains attachments and editing`, async () => {
			const { app, published } = fixture(false, local);
			const original = await (await app.request('/api/tickets/fixture-id/0001')).json();
			const response = await app.request('/api/tickets/fixture-id/0001', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: 'Saved title', description: 'Saved description', status: 'done' }),
			});
			expect(response.status).toBe(200);
			const saved = await response.json();
			expect(saved.title).toBe('Saved title');
			expect(saved.description).toBe('Saved description');
			expect(saved.status).toBe('done');
			expect(saved.attachments).toEqual(original.attachments);
			expect((await attach(app)).status).toBe(503);
			expect(published()).toBe(0);
			expect((await (await app.request('/api/tickets/fixture-id/0001')).json()).attachments).toEqual(
				original.attachments,
			);
		});
	}

	test('configured local app rejects uploads before publication and preserves attachments', async () => {
		const { app, published } = fixture(true, true);
		const original = await (await app.request('/api/tickets/fixture-id/0001')).json();
		const response = await attach(app);
		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Media uploads are unavailable in local mode');
		expect(published()).toBe(0);
		expect((await (await app.request('/api/tickets/fixture-id/0001')).json()).attachments).toEqual(
			original.attachments,
		);
	});

	for (const media of [false, true]) {
		test(`local excluded project returns 404 with media configured=${media} and never publishes`, async () => {
			const { app, published, context } = fixture(media, true);
			const original = await (await app.request('/api/tickets/fixture-id/0001')).json();
			const adapter = context.adapters.get('fixture-id');
			expect(adapter).toBeDefined();
			if (!adapter) throw new Error('Missing fixture adapter');
			const get = adapter.get;
			let reads = 0;
			adapter.get = async (id) => {
				reads++;
				return get(id);
			};
			const response = await app.request('/api/tickets/excluded/0001/attachments', {
				method: 'POST',
				body: 'not multipart',
			});
			expect(response.status).toBe(404);
			expect((await response.json()).error).toBe('Unknown project');
			expect(reads).toBe(0);
			expect(published()).toBe(0);
			expect((await (await app.request('/api/tickets/fixture-id/0001')).json()).attachments).toEqual(
				original.attachments,
			);
		});
	}

	test('configured normal mode retains upload failure and retry without losing existing evidence', async () => {
		const { app, published, setUploadFailure } = fixture(true);
		setUploadFailure(true);
		const failed = await attach(app);
		expect(failed.status).toBe(502);
		expect((await failed.json()).error).toBe('Fixture upload failed; try again');
		expect((await (await app.request('/api/tickets/fixture-id/0001')).json()).attachments).toHaveLength(1);
		setUploadFailure(false);
		const retried = await attach(app);
		expect(retried.status).toBe(201);
		const saved = await retried.json();
		expect(saved.attachments).toHaveLength(2);
		expect(saved.attachments[0].label).toBe('Existing evidence');
		expect(saved.attachments[1].kind).toBe('after');
		expect(published()).toBe(2);
	});
});
