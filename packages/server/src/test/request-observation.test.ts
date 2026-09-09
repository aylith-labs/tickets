import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { FolderAdapter } from '@aylith/tickets-core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createApp } from '../app';
import type { ServerContext } from '../context';
import { EventBus } from '../events';
import {
	createRequestObservation,
	TICKETS_OBSERVED_ROUTES,
	type TicketsObservationSink,
	type TicketsRequestObservation,
	type TicketsRequestObserver,
} from '../request-observation';

const PROJECT = 'PRIVATE-project-identity';
const PRIVATE = 'PRIVATE-body-query-header-exception';
const roots: string[] = [];
const observers: TicketsRequestObserver[] = [];
const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json', authorization: PRIVATE, 'x-private': PRIVATE },
	body: JSON.stringify(body),
});
const tick = () => new Promise<void>((done) => setImmediate(done));

afterEach(async () => {
	for (const observation of observers.splice(0)) observation.close();
	for (const root of roots.splice(0)) {
		// Only remove directories allocated by this test, directly under the OS temp root.
		if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('tickets-observation-')) {
			throw new Error('Refusing to remove a non-fixture directory');
		}
		await rm(root, { recursive: true, force: true });
	}
});

const fixture = async (sink?: TicketsObservationSink) => {
	const dataDir = await mkdtemp(join(tmpdir(), 'tickets-observation-'));
	roots.push(dataDir);
	const adapter = new FolderAdapter({ dataDir });
	const seeded = await adapter.create({ title: PRIVATE, description: PRIVATE });
	await writeFile(
		join(dataDir, '.tickets-store.json'),
		JSON.stringify({ schemaVersion: 1, id: PROJECT, kind: 'folder' }),
	);
	let forbidden = 0;
	const deny = (): never => {
		forbidden++;
		throw new Error('Unexpected provider or command');
	};
	const context: ServerContext = {
		config: {
			port: 0,
			apiBase: '/api',
			statuses: ['todo', 'done'],
			storeRoot: dataDir,
			worktreesRoot: dataDir,
			projects: [
				{ id: PROJECT, name: PRIVATE, repoPath: dataDir, location: { kind: 'folder', scope: 'repo', dataDir } },
			],
			terminals: [],
			enrich: { defaultProvider: '', providers: [] },
		},
		adapters: new Map([[PROJECT, adapter]]),
		events: new EventBus(),
		runCommand: deny,
		enrich: deny,
		publishMedia: deny,
	};
	const events: TicketsRequestObservation[] = [];
	const observation = createRequestObservation(
		sink ??
			((event) => {
				events.push(event);
				return true;
			}),
	);
	observers.push(observation);
	const app = createApp(context, { local: true, requestObservation: observation });
	return { app, context, observation, events, adapter, seeded, dataDir, forbidden: () => forbidden };
};

const expectSanitized = (events: TicketsRequestObservation[], before: number) => {
	const after = Date.now();
	for (const event of events) {
		expect(Object.keys(event).sort()).toEqual([
			'durationMs',
			'eventId',
			'kind',
			'method',
			'occurredAt',
			'routeId',
			'schemaVersion',
			'status',
		]);
		expect(Object.isFrozen(event)).toBe(true);
		expect(event.schemaVersion).toBe(1);
		expect(event.kind).toBe('request');
		expect(event.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(event.occurredAt).toBeGreaterThanOrEqual(before);
		expect(event.occurredAt).toBeLessThanOrEqual(after);
		expect(Number.isInteger(event.durationMs)).toBe(true);
		expect(event.durationMs).toBeGreaterThanOrEqual(0);
		expect(event.durationMs).toBeLessThanOrEqual(60_000);
		expect(TICKETS_OBSERVED_ROUTES.some((route) => route.id === event.routeId && route.method === event.method)).toBe(
			true,
		);
	}
	expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
	expect(JSON.stringify(events)).not.toContain(PRIVATE);
	expect(JSON.stringify(events)).not.toContain(PROJECT);
	expect(JSON.stringify(events)).not.toContain('/api/');
};

describe('opt-in native Tickets request observation', () => {
	test('preserves Hono compatibility and leaves default app requests unobserved', async () => {
		const f = await fixture();
		const plain = createApp(f.context);
		expect(plain).toBeInstanceOf(Hono);
		expect(f.app).toBeInstanceOf(Hono);
		const plainResponse = await plain.request('/api/projects');
		expect(plainResponse.status).toBe(200);
		expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 0 });
		const observed = await createApp(f.context, { requestObservation: f.observation }).request('/api/projects');
		expect(await observed.json()).toEqual(await plainResponse.json());
		expect([...observed.headers]).toEqual([...plainResponse.headers]);
		expect(f.events).toHaveLength(1);
	});

	test('observes real projects/list/detail/create/update without request or response content', async () => {
		const f = await fixture();
		const before = Date.now();
		expect((await f.app.request(`/api/projects?secret=${PRIVATE}`, { headers: { cookie: PRIVATE } })).status).toBe(200);
		const listed = await f.app.request(`/api/tickets?project=${PROJECT}&secret=${PRIVATE}%2F`);
		expect((await listed.json()).tickets[0].description).toBe(PRIVATE);
		expect((await f.app.request(`/api/tickets/${PROJECT}/${f.seeded.id}`)).status).toBe(200);
		const created = await f.app.request(
			'/api/tickets',
			json('POST', { project: PROJECT, title: PRIVATE, description: PRIVATE }),
		);
		expect(created.status).toBe(201);
		const ticket = await created.json();
		const updated = await f.app.request(
			`/api/tickets/${PROJECT}/${ticket.id}`,
			json('PATCH', { title: `${PRIVATE}-edit`, status: 'done' }),
		);
		expect(updated.status).toBe(200);
		expect((await updated.json()).title).toBe(`${PRIVATE}-edit`);
		expect((await new FolderAdapter({ dataDir: f.dataDir }).get(ticket.id))?.status).toBe('done');
		expect(f.events.map(({ routeId, method, status }) => [routeId, method, status])).toEqual([
			['tickets-projects', 'GET', 200],
			['tickets-list', 'GET', 200],
			['tickets-detail', 'GET', 200],
			['tickets-create', 'POST', 201],
			['tickets-update', 'PATCH', 200],
		]);
		expectSanitized(f.events, before);
		expect(JSON.stringify(f.events)).not.toContain(f.dataDir);
		expect(f.observation.snapshot()).toEqual({ active: true, accepted: 5, dropped: 0 });
		expect(f.forbidden()).toBe(0);
	});

	test('observes native validation and missing-resource statuses with constant labels', async () => {
		const f = await fixture();
		const before = Date.now();
		const detail = `/api/tickets/${PROJECT}/${f.seeded.id}`;
		const cases: [string, RequestInit | undefined, number][] = [
			['/api/tickets', json('POST', { project: PROJECT, title: '' }), 400],
			['/api/tickets', { method: 'POST', body: PRIVATE }, 400],
			['/api/tickets', json('POST', { project: PRIVATE, title: PRIVATE }), 201],
			['/api/tickets', json('POST', { project: 'missing-project', title: PRIVATE }), 404],
			[detail, { method: 'PATCH', body: PRIVATE }, 400],
			[detail, json('PATCH', { status: PRIVATE }), 400],
			[detail, json('PATCH', {}), 400],
			[`/api/tickets/${PROJECT}/PRIVATE-ticket-identity`, undefined, 404],
			['/api/tickets/missing-project/PRIVATE-ticket-identity', undefined, 404],
			['/api/tickets?project=missing-project', undefined, 404],
		];
		for (const [path, init, status] of cases) expect((await f.app.request(path, init)).status).toBe(status);
		expect(f.events.map((event) => event.status)).toEqual(cases.map((entry) => entry[2]));
		expectSanitized(f.events, before);
		expect(JSON.stringify(f.events)).not.toContain('PRIVATE-ticket-identity');
	});

	test('captures handled native 503 and actual storage create failure followed by recovery', async () => {
		const f = await fixture();
		const before = Date.now();
		f.context.adapters.delete(PROJECT);
		expect((await f.app.request(`/api/tickets?project=${PROJECT}`)).status).toBe(503);
		expect((await f.app.request(`/api/tickets/${PROJECT}/${f.seeded.id}`)).status).toBe(503);
		f.context.adapters.set(PROJECT, f.adapter);
		// Physically obstruct only this fixture's storage, preserving its original contents.
		await rename(join(f.dataDir, 'tickets'), join(f.dataDir, 'saved-tickets'));
		await writeFile(join(f.dataDir, 'tickets'), PRIVATE);
		const errors = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const failed = await f.app.request('/api/tickets', json('POST', { project: PROJECT, title: PRIVATE }));
			expect(failed.status).toBe(500);
			expect(await failed.text()).toBe('Internal Server Error');
		} finally {
			errors.mockRestore();
			await rename(join(f.dataDir, 'tickets'), join(f.dataDir, 'obstruction'));
			await rename(join(f.dataDir, 'saved-tickets'), join(f.dataDir, 'tickets'));
		}
		expect((await f.app.request('/api/tickets', json('POST', { project: PROJECT, title: PRIVATE }))).status).toBe(201);
		expect((await f.adapter.list()).length).toBe(2);
		expect(f.events.map((event) => event.status)).toEqual([503, 503, 500, 201]);
		expectSanitized(f.events, before);
		expect(JSON.stringify(f.events)).not.toContain(f.dataDir);
	});

	test('preserves thrown native route errors and Hono error-handler statuses and bodies', async () => {
		const f = await fixture();
		const before = Date.now();
		const fail = spyOn(f.adapter, 'list').mockRejectedValue(new Error(PRIVATE));
		const errors = spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect((await f.app.request('/api/tickets')).status).toBe(500);
			fail.mockRejectedValue(new HTTPException(502, { message: PRIVATE }));
			const handled = await f.app.request('/api/tickets');
			expect(handled.status).toBe(502);
			expect(await handled.text()).toBe(PRIVATE);
			f.app.onError((_error, c) => c.json({ error: PRIVATE }, 504));
			const custom = await f.app.request('/api/tickets');
			expect(custom.status).toBe(504);
			expect(await custom.json()).toEqual({ error: PRIVATE });
			// Hono rethrows non-Error values; the observer preserves the exact value.
			fail.mockRejectedValue(PRIVATE);
			await expect(f.app.request('/api/tickets')).rejects.toBe(PRIVATE);
		} finally {
			fail.mockRestore();
			errors.mockRestore();
		}
		expect(f.events.map((event) => event.status)).toEqual([500, 502, 504, 500]);
		expectSanitized(f.events, before);
	});

	test('excludes unknown routes, wrong methods and encoded aliases even when Hono serves them', async () => {
		const f = await fixture();
		const detail = `/api/tickets/${PROJECT}/${f.seeded.id}`;
		const cases: [string, string][] = [
			['/api/projects', 'HEAD'],
			['/api/projects', 'POST'],
			['/api/projects', 'PATCH'],
			['/api/projects', 'OPTIONS'],
			['/api/tickets', 'HEAD'],
			['/api/tickets', 'PATCH'],
			['/api/tickets', 'PUT'],
			['/api/tickets', 'DELETE'],
			[detail, 'HEAD'],
			[detail, 'POST'],
			[detail, 'OPTIONS'],
			['/api/unknown', 'GET'],
			['/api/projects/unknown', 'GET'],
			['/api/tickets/one-segment', 'GET'],
			['/api/projects/', 'GET'],
			['/api/tickets/', 'POST'],
			[`${detail}/`, 'GET'],
			['/api//tickets', 'GET'],
			['/api/Projects', 'GET'],
			['/api/tickets-other', 'POST'],
			['/api/%70rojects', 'GET'],
			['/%61pi/projects', 'GET'],
			['/api/%74ickets', 'GET'],
			['/api/tickets%2f', 'GET'],
			['/api/tickets%252f', 'GET'],
			['/api/%ZZtickets', 'GET'],
			[`/api/tickets/%50RIVATE-project-identity/${f.seeded.id}`, 'GET'],
			[`/api/tickets/${PROJECT}/%30${f.seeded.id.slice(1)}`, 'GET'],
			[`/api/tickets/${PROJECT}/%2f${f.seeded.id}`, 'GET'],
			[`/api/tickets/${PROJECT}/%5c${f.seeded.id}`, 'PATCH'],
		];
		for (const [path, method] of cases) {
			const response = await f.app.request(path, { method });
			await response.text();
		}
		// Confirm this exercises a decoding alias Hono actually accepts.
		expect((await f.app.request('/api/%70rojects')).status).toBe(200);
		expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 0 });
		expect(f.events).toEqual([]);
		expect(f.forbidden()).toBe(0);
	});

	test('excludes native media, launch/enrich, archive/prompt/revisions and private suite/triage ingress', async () => {
		const f = await fixture();
		const detail = `/api/tickets/${PROJECT}/${f.seeded.id}`;
		const cases: [string, string, number][] = [
			[`${detail}/attachments`, 'POST', 503],
			[`${detail}/launch`, 'POST', 400],
			[`${detail}/enrich`, 'POST', 400],
			[`${detail}/archive`, 'POST', 200],
			[`${detail}/prompt`, 'GET', 200],
			[`${detail}/revisions`, 'GET', 200],
			[`${detail}/revisions/missing`, 'GET', 404],
			[`${detail}/revisions/missing/restore`, 'POST', 400],
			[`/api/suite/projects/${PROJECT}/tickets/${f.seeded.id}`, 'GET', 200],
		];
		for (const [path, method, status] of cases) expect((await f.app.request(path, { method })).status).toBe(status);
		const triage = createApp(f.context, {
			requestObservation: f.observation,
			incidentTriage: {
				projectId: PROJECT,
				adapter: f.adapter,
				dataDir: f.dataDir,
				allowedScope: { tenantId: 'fixture-tenant', appId: 'tickets', sourceInstanceId: 'fixture-source' },
				hubOrigin: 'http://127.0.0.1:6325',
				authority: () => null,
			},
		});
		const denied = await triage.request('/api/incident-triage/incidents/10000000-0000-4000-8000-000000000001');
		expect(denied.status).toBe(401);
		expect(f.events).toEqual([]);
		expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 0 });
		expect(f.forbidden()).toBe(0);
	});

	test('excludes a real SSE response and releases its subscription after cancellation', async () => {
		const f = await fixture();
		let subscriptions = 0;
		const subscribe = f.context.events.subscribe.bind(f.context.events);
		const subscription = spyOn(f.context.events, 'subscribe').mockImplementation((listener) => {
			subscriptions++;
			const unsubscribe = subscribe(listener);
			let active = true;
			return () => {
				if (active) subscriptions--;
				active = false;
				unsubscribe();
			};
		});
		const response = await f.app.request('/api/events');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		try {
			expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('event: ping');
			expect(subscriptions).toBe(1);
		} finally {
			await reader?.cancel();
			subscription.mockRestore();
		}
		expect(subscriptions).toBe(0);
		expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 0 });
	});

	test.each(['reject', 'throw', 'nonboolean'] as const)(
		'sink %s never changes native success or failure',
		async (mode) => {
			const f = await fixture(() => {
				if (mode === 'throw') throw new Error(PRIVATE);
				return mode === 'reject' ? false : (1 as unknown as boolean);
			});
			const created = await f.app.request('/api/tickets', json('POST', { project: PROJECT, title: PRIVATE }));
			expect(created.status).toBe(201);
			expect((await created.json()).title).toBe(PRIVATE);
			expect((await f.adapter.list()).length).toBe(2);
			f.context.adapters.delete(PROJECT);
			const failed = await f.app.request(`/api/tickets?project=${PROJECT}`);
			expect(failed.status).toBe(503);
			expect(await failed.json()).toEqual({ error: 'Project unavailable' });
			expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 2 });
		},
	);

	test.each(['resolve', 'reject', 'thenable', 'getter'] as const)(
		'async sink misuse (%s) is dropped without unhandled rejection',
		async (mode) => {
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => {
				unhandled.push(reason);
			};
			process.on('unhandledRejection', onUnhandled);
			const sink = () => {
				if (mode === 'resolve') return Promise.resolve(true);
				if (mode === 'reject') return Promise.reject(new Error(PRIVATE));
				if (mode === 'getter')
					return Object.defineProperty({}, 'then', {
						get: () => {
							throw new Error(PRIVATE);
						},
					});
				// Deliberately malformed runtime input from an untyped host.
				return Object.defineProperty({}, 'then', {
					value: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error(PRIVATE)),
				});
			};
			try {
				const f = await fixture(sink as unknown as TicketsObservationSink);
				const response = await f.app.request('/api/projects');
				expect(response.status).toBe(200);
				expect((await response.json()).projects[0].id).toBe(PROJECT);
				await tick();
				expect(unhandled).toEqual([]);
				expect(f.observation.snapshot()).toEqual({ active: true, accepted: 0, dropped: 1 });
			} finally {
				process.off('unhandledRejection', onUnhandled);
			}
		},
	);

	test('does not await an async sink, and consumes rejection after close without changing counters', async () => {
		const deferred = Promise.withResolvers<boolean>();
		const f = await fixture((() => deferred.promise) as unknown as TicketsObservationSink);
		try {
			const response = await f.app.request('/api/projects');
			expect(response.status).toBe(200);
			f.observation.close();
			expect(f.observation.snapshot()).toEqual({ active: false, accepted: 0, dropped: 1 });
		} finally {
			deferred.reject(new Error(PRIVATE));
			await tick();
		}
		expect(f.observation.snapshot()).toEqual({ active: false, accepted: 0, dropped: 1 });
	});

	test('close suppresses in-flight and future observations while native writes finish', async () => {
		const f = await fixture();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const create = f.adapter.create.bind(f.adapter);
		const pendingCreate = spyOn(f.adapter, 'create').mockImplementation(async (input) => {
			started.resolve();
			await release.promise;
			return create(input);
		});
		const pending = f.app.request('/api/tickets', json('POST', { project: PROJECT, title: PRIVATE }));
		try {
			await started.promise;
			f.observation.close();
			f.observation.close();
		} finally {
			release.resolve();
			pendingCreate.mockRestore();
		}
		expect((await pending).status).toBe(201);
		expect((await f.app.request('/api/tickets')).status).toBe(200);
		expect((await f.adapter.list()).length).toBe(2);
		expect(f.events).toEqual([]);
		expect(f.observation.snapshot()).toEqual({ active: false, accepted: 0, dropped: 0 });
	});

	test('bounds negative, excessive and nonfinite elapsed duration on real native requests', async () => {
		const f = await fixture();
		const now = spyOn(performance, 'now');
		try {
			for (const [end, expected] of [
				[110.6, 11],
				[80, 0],
				[100_000, 60_000],
				[Number.NaN, 0],
				[Infinity, 0],
			]) {
				now.mockReturnValueOnce(100).mockReturnValueOnce(end as number);
				expect((await f.app.request('/api/projects')).status).toBe(200);
				expect(f.events.at(-1)?.durationMs).toBe(expected);
			}
		} finally {
			now.mockRestore();
		}
	});
});
