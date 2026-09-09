import { describe, expect, mock, test } from 'bun:test';
import type { StorageAdapter, Ticket } from '@aylith/tickets-core';
import { createApp } from '../app';
import type { ServerContext } from '../context';
import { EventBus } from '../events';
import { registerSuiteContextRoutes } from '../suite-context';
import type { DaemonConfig } from '../types/DaemonConfig';
import type { ProjectEntry } from '../types/ProjectEntry';

const PROJECT = 'stable_A-123';
const PRIVATE = 'PRIVATE /owner/source token=secret';
const project = (id = PROJECT): ProjectEntry => ({
	id,
	name: 'Same display name',
	repoPath: '/fixture/repository',
	location: { kind: 'folder', scope: 'repo', dataDir: '/fixture/source' },
});
const sourceTicket = (patch: Record<string, unknown> = {}): Ticket =>
	({
		id: '0001',
		title: 'Native ticket',
		description: 'Source Markdown.\n\n- A task',
		status: 'needs_review',
		archived: false,
		created: '2026-09-08T01:02:03.000Z',
		updated: '2026-09-08T02:03:04.123Z',
		attachments: [{ url: PRIVATE, kind: 'other', type: 'image' }],
		path: PRIVATE,
		...patch,
	}) as Ticket;

const fixture = (read: (id: string) => unknown = () => sourceTicket()) => {
	const forbidden = mock(() => {
		throw new Error(`Unexpected capability: ${PRIVATE}`);
	});
	const get = mock(async (id: string) => (await read(id)) as Ticket | null);
	const adapter: StorageAdapter = {
		get,
		list: forbidden,
		create: forbidden,
		update: forbidden,
		archive: forbidden,
		getRevisions: forbidden,
		getRevision: forbidden,
		restoreRevision: forbidden,
	};
	const config: DaemonConfig = {
		port: 0,
		apiBase: '/api',
		statuses: ['todo', 'needs_review', 'custom_done'],
		storeRoot: '/fixture/store',
		worktreesRoot: '/fixture/worktrees',
		projects: [project()],
		terminals: [],
		enrich: { defaultProvider: '', providers: [] },
		onStatusChange: PRIVATE,
	};
	const adapters = new Map([[PROJECT, adapter]]);
	const adapterAccess = mock(adapters.get.bind(adapters));
	adapters.get = adapterAccess;
	const events = new EventBus();
	events.subscribe(forbidden);
	const context: ServerContext = {
		config,
		adapters,
		events,
		runCommand: forbidden,
		enrich: forbidden,
		publishMedia: forbidden,
	};
	const app = createApp(context);
	return { app, context, config, adapter, get, forbidden, adapterAccess };
};

const path = (projectId = PROJECT, ticketId = '0001') =>
	`/api/suite/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`;

const entryAt = (f: { config: DaemonConfig }, index = 0): ProjectEntry => {
	const entry = f.config.projects[index];
	if (!entry) throw new Error('Missing fixture project');
	return entry;
};
const locationAt = (f: { config: DaemonConfig }) => {
	const location = entryAt(f).location;
	if (!location) throw new Error('Missing fixture location');
	return location;
};

const expectHeaders = (response: Response) => {
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('allow')).toBe('GET');
};

const expectFailure = async (response: Response, status: number, code: string) => {
	expect(response.status).toBe(status);
	expectHeaders(response);
	expect(await response.json()).toEqual({ schemaVersion: 1, capability: 'tickets-ticket', error: { code } });
};

describe('source-owned Tickets suite capability', () => {
	test('projects only the versioned ticket fields with exact stable identity and native status', async () => {
		const f = fixture();
		const before = JSON.stringify(f.config);
		const response = await f.app.request(path());
		expect(response.status).toBe(200);
		expectHeaders(response);
		expect(await response.json()).toEqual({
			schemaVersion: 1,
			capability: 'tickets-ticket',
			project: { id: PROJECT },
			ticket: {
				id: '0001',
				title: 'Native ticket',
				description: 'Source Markdown.\n\n- A task',
				status: 'needs_review',
				archived: false,
				created: '2026-09-08T01:02:03.000Z',
				updated: '2026-09-08T02:03:04.123Z',
			},
		});
		expect(f.get.mock.calls).toEqual([['0001']]);
		expect(f.forbidden).not.toHaveBeenCalled();
		expect(JSON.stringify(f.config)).toBe(before);
	});

	test('same-name projects retain separate source adapters and IDs', async () => {
		const f = fixture();
		const secondGet = mock(async () => sourceTicket({ title: 'Second source' }));
		f.config.projects.push(project('other_id'));
		f.context.adapters.set('other_id', { ...f.adapter, get: secondGet });
		const first = await (await f.app.request(path())).json();
		const second = await (await f.app.request(path('other_id'))).json();
		expect(first.project.id).toBe(PROJECT);
		expect(first.ticket.title).toBe('Native ticket');
		expect(second.project.id).toBe('other_id');
		expect(second.ticket.title).toBe('Second source');
		expect(f.get).toHaveBeenCalledTimes(1);
		expect(secondGet).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	test('rename preserves stable access; names and case variants never resolve', async () => {
		const f = fixture();
		entryAt(f).name = 'Renamed';
		expect((await (await f.app.request(path())).json()).project).toEqual({ id: PROJECT });
		for (const id of ['Renamed', 'Same display name', PROJECT.toLowerCase()]) {
			const response = await f.app.request(path(id));
			await expectFailure(response, 404, 'project_not_found');
		}
		expect(f.get).toHaveBeenCalledTimes(1);
	});

	for (const id of ['a', '_', '-', 'x'.repeat(1000), 'a.b', 'a:b', 'a b', 'é', '%2f', '%2e%2e']) {
		test(`accepts bounded opaque stable project ID (${id.length} characters, ${id[0]})`, async () => {
			const f = fixture();
			f.config.projects = [project(id)];
			f.context.adapters = new Map([[id, f.adapter]]);
			expect((await (await f.app.request(path(id))).json()).project).toEqual({ id });
		});
	}

	for (const id of ['0', '1', '0001', '0000000000000000', '9999999999999999']) {
		test(`preserves native decimal ticket ID ${id}`, async () => {
			const f = fixture(() => sourceTicket({ id, archived: true, updated: undefined, description: '' }));
			const response = await f.app.request(path(PROJECT, id));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.ticket.id).toBe(id);
			expect(body.ticket.archived).toBe(true);
			expect(body.ticket.description).toBe('');
			expect(body.ticket).not.toHaveProperty('updated');
			expect(f.get.mock.calls).toEqual([[id]]);
		});
	}

	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'PROPFIND']) {
		test(`${method} rejects before config/adapter access, including preflight`, async () => {
			const f = fixture();
			const configAccess = mock(() => {
				throw new Error(PRIVATE);
			});
			Object.defineProperty(f.context, 'config', { get: configAccess });
			const response = await f.app.request(path(), {
				method,
				headers: { origin: 'http://localhost:7777', 'access-control-request-method': 'POST' },
			});
			if (method === 'HEAD') {
				expect(response.status).toBe(405);
				expectHeaders(response);
				expect(await response.text()).toBe('');
			} else {
				await expectFailure(response, 405, 'method_not_allowed');
			}
			expect(configAccess).not.toHaveBeenCalled();
			expect(f.adapterAccess).not.toHaveBeenCalled();
			expect(f.get).not.toHaveBeenCalled();
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	const badProjects = [
		'',
		'x'.repeat(1001),
		'a/b',
		'a\\b',
		'../x',
		'   ',
		'\0',
		'\n',
		'\r',
		'\t',
		'\u007f',
		'\u0085',
		'\u202e',
	];
	const badTickets = ['', '1'.repeat(17), '-1', '+1', '1.0', '1e2', 'a', '1/2', '1\\2', '%2f', ' 1', '１', '\0', '\n'];
	for (const [label, url] of [
		...badProjects.map((id) => [`project ${JSON.stringify(id)}`, path(id)]),
		...badTickets.map((id) => [`ticket ${JSON.stringify(id)}`, path(PROJECT, id)]),
		['malformed encoding', `/api/suite/projects/%E0%A4%A/tickets/0001`],
		['extra path', `${path()}/attachments`],
	] as [string, string][]) {
		test(`invalid ${label} fails before config and adapter access`, async () => {
			const f = fixture();
			const configAccess = mock(() => {
				throw new Error(PRIVATE);
			});
			Object.defineProperty(f.context, 'config', { get: configAccess });
			await expectFailure(await f.app.request(url), 400, 'invalid_request');
			expect(configAccess).not.toHaveBeenCalled();
			expect(f.adapterAccess).not.toHaveBeenCalled();
			expect(f.get).not.toHaveBeenCalled();
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	for (const segment of ['.', '..', '%2e', '%2e%2e']) {
		test(`URL-normalized dot traversal ${segment} never reaches the adapter`, async () => {
			const f = fixture();
			const response = await f.app.request(`/api/suite/projects/${segment}/tickets/0001`);
			expect([400, 404]).toContain(response.status);
			expect(f.get).not.toHaveBeenCalled();
			expect(f.adapterAccess).not.toHaveBeenCalled();
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	const invalidConfigurations: [string, (f: ReturnType<typeof fixture>) => void][] = [
		['duplicate requested ID', (f) => f.config.projects.push(project())],
		[
			'missing projects',
			(f) => {
				f.config.projects = undefined as unknown as ProjectEntry[];
			},
		],
		[
			'missing config',
			(f) => {
				f.context.config = null as unknown as DaemonConfig;
			},
		],
		[
			'empty statuses',
			(f) => {
				f.config.statuses = [];
			},
		],
		[
			'duplicate statuses',
			(f) => {
				f.config.statuses.push('todo');
			},
		],
		[
			'invalid status',
			(f) => {
				f.config.statuses = [''];
			},
		],
		[
			'missing statuses',
			(f) => {
				f.config.statuses = undefined as unknown as string[];
			},
		],
		[
			'malformed location',
			(f) => {
				entryAt(f).location = null as unknown as ProjectEntry['location'];
			},
		],
		[
			'malformed availability',
			(f) => {
				entryAt(f).unavailable = false as unknown as string;
			},
		],
	];
	for (const [label, change] of invalidConfigurations) {
		test(`malformed config rejects ${label} without adapter access`, async () => {
			const f = fixture();
			change(f);
			await expectFailure(await f.app.request(path()), 409, 'invalid_configuration');
			expect(f.adapterAccess).not.toHaveBeenCalled();
			expect(f.get).not.toHaveBeenCalled();
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	test('unknown project and missing ticket are explicit 404s', async () => {
		const f = fixture(() => null);
		await expectFailure(await f.app.request(path('unknown')), 404, 'project_not_found');
		expect(f.adapterAccess).not.toHaveBeenCalled();
		await expectFailure(await f.app.request(path()), 404, 'ticket_not_found');
		expect(f.get).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	test('healthy target remains readable alongside unrelated legacy, unavailable and duplicate entries', async () => {
		const f = fixture();
		f.config.projects.push(
			{ name: 'legacy', repoPath: '/fixture/legacy' },
			{ ...project('unavailable'), unavailable: PRIVATE },
			project('unrelated-duplicate'),
			project('unrelated-duplicate'),
		);
		const before = JSON.stringify(f.config);
		expect((await f.app.request(path())).status).toBe(200);
		await expectFailure(await f.app.request(path('legacy')), 404, 'project_not_found');
		await expectFailure(await f.app.request(path('unavailable')), 503, 'source_unavailable');
		await expectFailure(await f.app.request(path('unrelated-duplicate')), 409, 'invalid_configuration');
		expect(f.get).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
		expect(JSON.stringify(f.config)).toBe(before);
	});

	for (const missingId of [undefined, '', '../private', null, 123]) {
		test(`legacy-only or malformed ID ${JSON.stringify(missingId)} never resolves by its matching name`, async () => {
			const f = fixture();
			f.config.projects = [{ ...project(), id: missingId as string | undefined, name: PROJECT }];
			await expectFailure(await f.app.request(path()), 404, 'project_not_found');
			expect(f.adapterAccess).not.toHaveBeenCalled();
			expect(f.get).not.toHaveBeenCalled();
		});
	}

	test('adding unrelated legacy/unavailable entries during a delayed read does not change its mapping', async () => {
		const started = Promise.withResolvers<void>();
		const result = Promise.withResolvers<Ticket>();
		const f = fixture(() => {
			started.resolve();
			return result.promise;
		});
		const pending = f.app.request(path());
		await started.promise;
		f.config.projects.push({ name: 'legacy', repoPath: '/fixture/legacy', unavailable: PRIVATE });
		result.resolve(sourceTicket());
		expect((await pending).status).toBe(200);
		expect(f.get).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	for (const [label, change] of [
		[
			'unavailable project',
			(f) => {
				entryAt(f).unavailable = PRIVATE;
			},
		],
		[
			'missing adapter',
			(f) => {
				f.context.adapters.clear();
			},
		],
		[
			'name-only adapter',
			(f) => {
				f.context.adapters = new Map([['Same display name', f.adapter]]);
			},
		],
		[
			'missing get capability',
			(f) => {
				f.adapter.get = undefined as unknown as StorageAdapter['get'];
			},
		],
	] as [string, (f: ReturnType<typeof fixture>) => void][]) {
		test(`${label} fails explicitly without reading tickets`, async () => {
			const f = fixture();
			change(f);
			await expectFailure(await f.app.request(path()), 503, 'source_unavailable');
			expect(f.get).not.toHaveBeenCalled();
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	const malformedTickets: [string, unknown][] = [
		['undefined', undefined],
		['array', []],
		['string', PRIVATE],
		...[
			{ id: '1' },
			{ id: 1 },
			{ id: undefined },
			{ title: '' },
			{ title: '   ' },
			{ title: null },
			{ title: 'x'.repeat(10001) },
			{ description: null },
			{ description: undefined },
			{ description: {} },
			{ description: 'x'.repeat(10001) },
			{ status: 'done' },
			{ status: 'NEEDS_REVIEW' },
			{ status: undefined },
			{ status: {} },
			{ archived: 0 },
			{ archived: 'false' },
			{ archived: undefined },
			{ created: '2026-09-08' },
			{ created: '2026-13-30T01:02:03.000Z' },
			{ created: '2026-09-08T25:00:00Z' },
			{ created: '2026-09-08T' },
			{ created: null },
			{ updated: null },
			{ updated: 'invalid' },
			{ updated: '2026-08-08T01:02:03Z' },
		].map((patch, index): [string, unknown] => [`field ${index}: ${Object.keys(patch)[0]}`, sourceTicket(patch)]),
	];
	for (const [label, value] of malformedTickets) {
		test(`malformed ticket ${label} returns sanitized invalid_source`, async () => {
			const f = fixture(() => value);
			await expectFailure(await f.app.request(path()), 502, 'invalid_source');
			expect(f.get).toHaveBeenCalledTimes(1);
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	test('source exceptions and accessors do not leak private failure details', async () => {
		const failing = fixture(() => {
			throw new Error(PRIVATE);
		});
		await expectFailure(await failing.app.request(path()), 503, 'source_unavailable');
		const value = sourceTicket();
		Object.defineProperty(value, 'title', {
			get: () => {
				throw new Error(PRIVATE);
			},
		});
		const malformed = fixture(() => value);
		await expectFailure(await malformed.app.request(path()), 502, 'invalid_source');
		expect(failing.forbidden).not.toHaveBeenCalled();
		expect(malformed.forbidden).not.toHaveBeenCalled();
	});

	test('does not inspect excluded fields or serialize the source object', async () => {
		const value = sourceTicket();
		const forbidden = mock(() => {
			throw new Error(PRIVATE);
		});
		for (const key of ['attachments', 'path', 'toJSON']) Object.defineProperty(value, key, { get: forbidden });
		Object.freeze(value);
		const f = fixture(() => value);
		Object.freeze(entryAt(f).location);
		Object.freeze(f.config.projects[0]);
		Object.freeze(f.config.projects);
		Object.freeze(f.config.statuses);
		Object.freeze(f.config);
		expect((await f.app.request(path())).status).toBe(200);
		expect(forbidden).not.toHaveBeenCalled();
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	for (const timestamp of [
		'2024-02-29T23:59:59Z',
		'2026-09-08T01:02:03.1Z',
		'2026-09-08T01:02:03.12Z',
		'2026-09-08T01:02:03+00:00',
	]) {
		test(`preserves valid UTC ISO timestamp ${timestamp}`, async () => {
			const f = fixture(() => sourceTicket({ created: timestamp, updated: timestamp }));
			const response = await f.app.request(path());
			expect(response.status).toBe(200);
			expect((await response.json()).ticket.created).toBe(timestamp);
		});
	}

	const delayedChanges: [string, (f: ReturnType<typeof fixture>) => void, number, string][] = [
		[
			'config replaced',
			(f) => {
				f.context.config = { ...f.config };
			},
			409,
			'mapping_changed',
		],
		[
			'projects replaced',
			(f) => {
				f.config.projects = [...f.config.projects];
			},
			409,
			'mapping_changed',
		],
		[
			'project replaced',
			(f) => {
				f.config.projects[0] = project();
			},
			409,
			'mapping_changed',
		],
		[
			'project renamed',
			(f) => {
				entryAt(f).name = 'Renamed';
			},
			409,
			'mapping_changed',
		],
		[
			'project remapped',
			(f) => {
				locationAt(f).dataDir = '/fixture/other';
			},
			409,
			'mapping_changed',
		],
		[
			'location replaced',
			(f) => {
				entryAt(f).location = { ...locationAt(f) };
			},
			409,
			'mapping_changed',
		],
		[
			'adapter map replaced',
			(f) => {
				f.context.adapters = new Map(f.context.adapters);
			},
			409,
			'mapping_changed',
		],
		[
			'adapter replaced',
			(f) => {
				f.context.adapters.set(PROJECT, { ...f.adapter });
			},
			409,
			'mapping_changed',
		],
		[
			'get replaced',
			(f) => {
				f.adapter.get = async () => sourceTicket({ title: 'replacement' });
			},
			409,
			'mapping_changed',
		],
		[
			'statuses changed',
			(f) => {
				f.config.statuses.push('another_native_status');
			},
			409,
			'mapping_changed',
		],
		[
			'status removed',
			(f) => {
				f.config.statuses = ['todo'];
			},
			409,
			'mapping_changed',
		],
		[
			'duplicate introduced',
			(f) => {
				f.config.projects.push(project());
			},
			409,
			'invalid_configuration',
		],
		[
			'source unavailable',
			(f) => {
				entryAt(f).unavailable = PRIVATE;
			},
			503,
			'source_unavailable',
		],
		[
			'adapter removed',
			(f) => {
				f.context.adapters.clear();
			},
			503,
			'source_unavailable',
		],
		[
			'project removed',
			(f) => {
				f.config.projects = [];
			},
			404,
			'project_not_found',
		],
	];
	for (const [label, change, status, code] of delayedChanges) {
		for (const outcome of ['success', 'missing', 'failure'] as const) {
			test(`delayed ${outcome} discarded after ${label}`, async () => {
				const started = Promise.withResolvers<void>();
				const result = Promise.withResolvers<Ticket | null>();
				const f = fixture(() => {
					started.resolve();
					return result.promise;
				});
				const pending = f.app.request(path());
				await started.promise;
				change(f);
				if (outcome === 'failure') result.reject(new Error(PRIVATE));
				else result.resolve(outcome === 'missing' ? null : sourceTicket());
				await expectFailure(await pending, status, code);
				expect(f.get).toHaveBeenCalledTimes(1);
				expect(f.forbidden).not.toHaveBeenCalled();
			});
		}
	}

	test('unchanged delayed read succeeds, with exactly one source read and no writes', async () => {
		const started = Promise.withResolvers<void>();
		const result = Promise.withResolvers<Ticket>();
		const f = fixture(() => {
			started.resolve();
			return result.promise;
		});
		const pending = f.app.request(path());
		await started.promise;
		result.resolve(sourceTicket());
		expect((await pending).status).toBe(200);
		expect(f.get).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
	});
});

const apiFixture = () => {
	const f = fixture();
	f.context.events = new EventBus();
	f.config.onStatusChange = undefined;
	f.config.projects = [project(), project('other_id')];
	const createSource = (title: string) => {
		let value = sourceTicket({ title, attachments: [] });
		const calls = mock((..._args: unknown[]) => {});
		const adapter: StorageAdapter = {
			list: async () => {
				calls('list');
				return [value];
			},
			get: async (id) => {
				calls('get', id);
				return value;
			},
			create: async (input) => {
				calls('create');
				value = { ...value, ...input };
				return value;
			},
			update: async (id, patch) => {
				calls('update', id);
				value = { ...value, ...patch };
				return value;
			},
			archive: async (id) => {
				calls('archive', id);
				value = { ...value, archived: true };
				return value;
			},
			getRevisions: async (id) => {
				calls('revisions', id);
				return [];
			},
			getRevision: async (id) => {
				calls('revision', id);
				return value;
			},
			restoreRevision: async (id) => {
				calls('restore', id);
				return value;
			},
		};
		return { adapter, calls, current: () => value };
	};
	const first = createSource('First source');
	const second = createSource('Second source');
	f.context.adapters = new Map([
		[PROJECT, first.adapter],
		['other_id', second.adapter],
	]);
	f.config.terminals = [{ id: 'fixture', label: 'Fixture', command: 'fixture $PROMPT_URL' }];
	f.config.enrich = { defaultProvider: 'fixture', providers: [{ id: 'fixture', kind: 'claude-cli' }] };
	f.config.media = { repoPath: '/fixture/media', baseUrl: '/fixture/media', pathPrefix: 'tickets' };
	f.context.runCommand = mock(() => {});
	f.context.enrich = mock(async () => ({ title: 'Enriched first', description: 'Enriched description' }));
	f.context.publishMedia = mock(async () => ({
		url: '/fixture/media.png',
		kind: 'other' as const,
		type: 'image' as const,
	}));
	return { ...f, first, second };
};

const jsonBody = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});

describe('native API project identity regression', () => {
	test('list by stable ID does not aggregate same-name sources', async () => {
		const f = apiFixture();
		const response = await f.app.request(`/api/tickets?project=${PROJECT}`);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.tickets).toHaveLength(1);
		expect(body.tickets[0].title).toBe('First source');
		expect(body.tickets[0].projectId).toBe(PROJECT);
		expect(f.second.calls).not.toHaveBeenCalled();
	});

	test('unfiltered list preserves distinct stable identities for same-name projects', async () => {
		const f = apiFixture();
		const body = await (await f.app.request('/api/tickets')).json();
		expect(body.tickets.map((ticket: { projectId: string }) => ticket.projectId)).toEqual([PROJECT, 'other_id']);
	});

	test('exact ID takes precedence over another stable project display name for list and patch', async () => {
		const f = apiFixture();
		entryAt(f, 1).name = PROJECT;
		const before = JSON.stringify(f.second.current());
		const listed = await (await f.app.request(`/api/tickets?project=${PROJECT}`)).json();
		expect(listed.tickets).toHaveLength(1);
		expect(listed.tickets[0].projectId).toBe(PROJECT);
		const response = await f.app.request(`/api/tickets/${PROJECT}/0001`, jsonBody('PATCH', { title: 'Intended edit' }));
		expect(response.status).toBe(200);
		expect((await response.json()).projectId).toBe(PROJECT);
		expect(f.first.current().title).toBe('Intended edit');
		expect(JSON.stringify(f.second.current())).toBe(before);
		expect(f.second.calls).not.toHaveBeenCalled();
	});

	const operations: [string, (key: string) => string, () => RequestInit | undefined, number][] = [
		['create', () => '/api/tickets', () => jsonBody('POST', { project: PROJECT, title: 'Created first' }), 201],
		['get', (key) => `/api/tickets/${key}/0001`, () => undefined, 200],
		['patch', (key) => `/api/tickets/${key}/0001`, () => jsonBody('PATCH', { title: 'Edited first' }), 200],
		['archive', (key) => `/api/tickets/${key}/0001/archive`, () => ({ method: 'POST' }), 200],
		['revision', (key) => `/api/tickets/${key}/0001/revisions/ref`, () => undefined, 200],
		['restore', (key) => `/api/tickets/${key}/0001/revisions/ref/restore`, () => ({ method: 'POST' }), 200],
		['enrich', (key) => `/api/tickets/${key}/0001/enrich`, () => ({ method: 'POST' }), 200],
		['launch', (key) => `/api/tickets/${key}/0001/launch`, () => ({ method: 'POST' }), 200],
		[
			'upload',
			(key) => `/api/tickets/${key}/0001/attachments`,
			() => {
				const form = new FormData();
				form.set('file', new File(['fixture'], 'fixture.png', { type: 'image/png' }));
				return { method: 'POST', body: form };
			},
			201,
		],
	];
	for (const [name, url, init, expectedStatus] of operations) {
		test(`${name} targets one stable source and includes projectId without losing project`, async () => {
			const f = apiFixture();
			const before = JSON.stringify(f.second.current());
			const response = await f.app.request(url(PROJECT), init());
			expect(response.status).toBe(expectedStatus);
			const body = await response.json();
			const ticket = name === 'launch' ? body.ticket : body;
			expect(ticket.projectId).toBe(PROJECT);
			expect(ticket.project).toBe('Same display name');
			expect(ticket.id).toBe('0001');
			expect(f.first.calls).toHaveBeenCalled();
			expect(f.second.calls).not.toHaveBeenCalled();
			expect(JSON.stringify(f.second.current())).toBe(before);
			expect(f.forbidden).not.toHaveBeenCalled();
		});
	}

	for (const collision of ['ambiguous name', 'duplicate ID', 'legacy adapter key collision']) {
		for (const [name, url, init] of operations) {
			test(`${collision} denies ${name} without adapter or side-effect access`, async () => {
				const f = apiFixture();
				let key = PROJECT;
				if (collision === 'ambiguous name') key = 'Same display name';
				else if (collision === 'duplicate ID') entryAt(f, 1).id = PROJECT;
				else f.config.projects.push({ name: PROJECT, repoPath: '/fixture/legacy' });
				const options = name === 'create' ? jsonBody('POST', { project: key, title: 'Denied' }) : init();
				const response = await f.app.request(url(encodeURIComponent(key)), options);
				expect(response.status).toBe(409);
				expect(f.first.calls).not.toHaveBeenCalled();
				expect(f.second.calls).not.toHaveBeenCalled();
				expect(f.context.runCommand).not.toHaveBeenCalled();
				expect(f.context.enrich).not.toHaveBeenCalled();
				expect(f.context.publishMedia).not.toHaveBeenCalled();
			});
		}
		test(`${collision} denies filtered list without aggregation`, async () => {
			const f = apiFixture();
			let key = 'Same display name';
			if (collision === 'duplicate ID') entryAt(f, 1).id = PROJECT;
			else if (collision === 'legacy adapter key collision') {
				f.config.projects.push({ name: PROJECT, repoPath: '/fixture/legacy' });
				key = PROJECT;
			}
			expect((await f.app.request(`/api/tickets?project=${encodeURIComponent(key)}`)).status).toBe(409);
			expect(f.first.calls).not.toHaveBeenCalled();
			expect(f.second.calls).not.toHaveBeenCalled();
		});
	}

	for (const legacy of [false, true]) {
		test(`unique ${legacy ? 'id-less legacy' : 'stable project'} name remains compatible`, async () => {
			const f = apiFixture();
			entryAt(f).name = 'Unique';
			if (legacy) {
				delete entryAt(f).id;
				f.context.adapters.delete(PROJECT);
				f.context.adapters.set('Unique', f.first.adapter);
			}
			const listed = await (await f.app.request('/api/tickets?project=Unique')).json();
			expect(listed.tickets).toHaveLength(1);
			const response = await f.app.request(
				'/api/tickets/Unique/0001',
				jsonBody('PATCH', { title: 'Legacy compatible' }),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.project).toBe('Unique');
			expect(body.projectId).toBe(legacy ? undefined : PROJECT);
			expect(f.first.current().title).toBe('Legacy compatible');
			expect(f.second.calls).not.toHaveBeenCalled();
		});
	}

	test('helper is independently importable and bound limits agree with the Ayla projection', async () => {
		expect(typeof registerSuiteContextRoutes).toBe('function');
		const status = 's'.repeat(1000);
		const f = fixture(() => sourceTicket({ title: 't'.repeat(10000), description: 'd'.repeat(10000), status }));
		f.config.statuses = [status];
		expect((await f.app.request(path())).status).toBe(200);
		f.config.statuses = ['s'.repeat(1001)];
		await expectFailure(await f.app.request(path()), 409, 'invalid_configuration');
	});
});
