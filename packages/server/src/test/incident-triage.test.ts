import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderAdapter, GitBranchAdapter, incidentTicketId, parseTicket, serializeTicket } from '@aylith/tickets-core';
import { Hono } from 'hono';
import { createApp } from '../app';
import type { ServerContext } from '../context';
import { EventBus } from '../events';
import {
	type IncidentInput,
	type IncidentTriageConfig,
	type IncidentTriageGrant,
	registerIncidentTriageRoutes,
} from '../incident-triage';
import { allowsLocalRequest } from '../local-request';

const root = mkdtempSync(join(tmpdir(), 'tickets-incident-triage-'));
console.info(`Retained D069 fixture evidence: ${root}`);
const scope = { tenantId: 'tenant-a', sourceInstanceId: 'venture-local', appId: 'venture' };
const projectId = 'triage-project';
const incident: IncidentInput = {
	id: '10000000-0000-4000-8000-000000000001',
	scope,
	eventId: 'request-failure-1',
	fingerprint: 'request:GET:review:5xx',
	firstSeen: 1788886800000,
	lastSeen: 1788886800000,
};
const path = `/api/incident-triage/incidents/${incident.id}`;
const token = 'test-only-triage-token';
let sequence = 0;
const fixtures = () => {
	const dataDir = join(root, `fixture-${++sequence}`);
	mkdirSync(join(dataDir, 'tickets'), { recursive: true });
	writeFileSync(
		join(dataDir, '.tickets-store.json'),
		JSON.stringify({ schemaVersion: 1, id: projectId, kind: 'folder' }),
	);
	const adapter = new FolderAdapter({ dataDir });
	let grant: IncidentTriageGrant | null = {
		scope: { ...scope },
		projectId,
		roles: ['read', 'create'],
		expiresAt: Date.now() + 60000,
	};
	let calls = 0;
	let onAuthority = () => {};
	let forbidden = 0;
	const deny = (): never => {
		forbidden++;
		throw new Error('PRIVATE forbidden side effect');
	};
	const context: ServerContext = {
		config: {
			port: 0,
			apiBase: '/api',
			statuses: ['todo', 'done'],
			storeRoot: dataDir,
			worktreesRoot: dataDir,
			projects: [
				{
					id: projectId,
					name: 'Triage fixture',
					repoPath: dataDir,
					location: { kind: 'folder', scope: 'repo', dataDir },
				},
			],
			terminals: [],
			enrich: { defaultProvider: '', providers: [] },
		},
		adapters: new Map([[projectId, adapter]]),
		events: new EventBus(),
		runCommand: deny,
		enrich: deny,
		publishMedia: deny,
	};
	const config: IncidentTriageConfig = {
		context,
		projectId,
		adapter,
		dataDir,
		allowedScope: { ...scope },
		hubOrigin: 'http://127.0.0.1:6325',
		authority: (received) => {
			calls++;
			onAuthority();
			return received === token ? grant : null;
		},
	};
	const app = new Hono();
	registerIncidentTriageRoutes(app, config);
	app.route('/', createApp(context, { local: true }));
	const request = (method = 'GET', body: unknown = undefined, headers: Record<string, string> = {}) =>
		app.request(path, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const post = (value: unknown = { schemaVersion: 1, incident }) => request('POST', value);
	const id = incidentTicketId(projectId, scope, incident.id);
	const ticketPath = join(dataDir, 'tickets', `${id}.md`);
	return {
		dataDir,
		adapter,
		config,
		context,
		app,
		request,
		post,
		id,
		ticketPath,
		files: () => readdirSync(join(dataDir, 'tickets')),
		setGrant: (value: IncidentTriageGrant | null) => {
			grant = value;
		},
		grant: () => grant as IncidentTriageGrant,
		calls: () => calls,
		forbidden: () => forbidden,
		onAuthority: (callback: () => void) => {
			onAuthority = callback;
		},
	};
};
const failure = async (response: Response, code: string, status: number) => {
	expect(response.status).toBe(status);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.json()).toEqual({ schemaVersion: 1, error: { code } });
};

describe('opt-in native incident triage', () => {
	test('the same incident UUID in two authorized source scopes is isolated in native persistence', async () => {
		const f = fixtures();
		const otherScope = { ...scope, tenantId: 'tenant-b' };
		const otherIncident = { ...incident, scope: otherScope };
		const other = createApp(f.context, {
			incidentTriage: {
				...f.config,
				allowedScope: otherScope,
				authority: (received) => (received === token ? { ...f.grant(), scope: otherScope } : null),
			},
		});
		expect((await f.post()).status).toBe(201);
		const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
		expect((await (await other.request(path, { headers })).json()).ticket).toBeNull();
		const response = await other.request(path, {
			method: 'POST',
			headers,
			body: JSON.stringify({ schemaVersion: 1, incident: otherIncident }),
		});
		expect(response.status).toBe(201);
		const created = await response.json();
		expect(created.ticket.id).not.toBe(f.id);
		expect((await (await f.request()).json()).ticket.id).toBe(f.id);
		expect((await (await other.request(path, { headers })).json()).ticket.id).toBe(created.ticket.id);
		expect(f.files()).toHaveLength(2);
	});

	test('revocation or remapping while the request body is actually pending prevents all writes', async () => {
		for (const mutation of ['revoke', 'remap']) {
			const f = fixtures();
			let release: (bytes: Uint8Array) => void = () => {
				throw new Error('Missing stream controller');
			};
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					release = (bytes) => {
						controller.enqueue(bytes);
						controller.close();
					};
				},
			});
			const pending = f.app.fetch(
				new Request(`http://localhost${path}`, {
					method: 'POST',
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
					body,
				}),
			);
			expect(f.calls()).toBe(1);
			if (mutation === 'revoke') f.setGrant(null);
			else f.context.adapters.set(projectId, new FolderAdapter({ dataDir: f.dataDir }));
			release(new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, incident })));
			await failure(
				await pending,
				mutation === 'revoke' ? 'unauthorized' : 'mapping_changed',
				mutation === 'revoke' ? 401 : 409,
			);
			expect(f.files()).toEqual([]);
		}
	});

	test('default absent; explicit option creates ordinary API-visible native Markdown and returns a minimal read', async () => {
		const f = fixtures();
		expect((await createApp(f.context).request(path)).status).toBe(404);
		const { context: _context, ...option } = f.config;
		const app = createApp(f.context, { local: true, incidentTriage: option });
		expect(await (await app.request(path, { headers: { authorization: `Bearer ${token}` } })).json()).toEqual({
			schemaVersion: 1,
			projectId,
			ticket: null,
		});
		const result = await f.post();
		expect(result.status).toBe(201);
		const envelope = await result.json();
		expect(envelope.duplicate).toBe(false);
		expect(envelope.ticket.id).toMatch(/^[0-9]{1,16}$/);
		expect(Number.isSafeInteger(Number(envelope.ticket.id))).toBe(true);
		expect(Object.keys(envelope.ticket).sort()).toEqual(['created', 'id', 'status', 'title']);
		const native = await (await app.request(`/api/tickets/${projectId}/${envelope.ticket.id}`)).json();
		expect(native.id).toBe(envelope.ticket.id);
		expect(native.description).toContain(`${f.config.hubOrigin}/?incident=${incident.id}`);
		expect(native.incidentProvenance.incident).toEqual(incident);
		expect((await (await app.request(`/api/tickets?project=${projectId}`)).json()).tickets).toHaveLength(1);
		expect(await (await f.request()).json()).toEqual({ schemaVersion: 1, projectId, ticket: envelope.ticket });
		expect(f.files()).toEqual([`${envelope.ticket.id}.md`]);
		expect(f.forbidden()).toBe(0);
	});

	test('native edits/archive preserve provenance and retries never rewrite the ticket', async () => {
		const f = fixtures();
		await f.post();
		expect(
			(
				await f.app.request(`/api/tickets/${projectId}/${f.id}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ title: 'Owner edited triage', description: 'Keep my investigation', status: 'done' }),
				})
			).status,
		).toBe(200);
		expect((await f.app.request(`/api/tickets/${projectId}/${f.id}/archive`, { method: 'POST' })).status).toBe(200);
		const before = readFileSync(f.ticketPath, 'utf8');
		const reply = await f.post({
			schemaVersion: 1,
			incident: { ...incident, eventId: 'later-event', lastSeen: incident.lastSeen + 1000 },
		});
		expect(reply.status).toBe(200);
		expect((await reply.json()).ticket).toMatchObject({ title: 'Owner edited triage', status: 'done' });
		expect(readFileSync(f.ticketPath, 'utf8')).toBe(before);
		expect((await f.adapter.get(f.id))?.archived).toBe(true);
		expect(f.files()).toHaveLength(1);
	});

	test('20 concurrent retries across independent adapters return exactly one new ticket', async () => {
		const f = fixtures();
		const secondAdapter = new FolderAdapter({ dataDir: f.dataDir });
		const context = { ...f.context, adapters: new Map([[projectId, secondAdapter]]) };
		const app = createApp(context, { incidentTriage: { ...f.config, adapter: secondAdapter } });
		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				i % 2
					? f.post()
					: app.request(path, {
							method: 'POST',
							headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
							body: JSON.stringify({ schemaVersion: 1, incident }),
						}),
			),
		);
		expect(results.filter((response) => response.status === 201)).toHaveLength(1);
		expect(results.filter((response) => response.status === 200)).toHaveLength(19);
		const ids = await Promise.all(results.map(async (response) => (await response.json()).ticket.id));
		expect(new Set(ids).size).toBe(1);
		expect(f.files()).toHaveLength(1);
	});

	test('occupied deterministic ID fails without overwriting; malformed and unknown provenance remain explicit', async () => {
		for (const kind of ['collision', 'scope', 'version', 'malformed']) {
			const f = fixtures();
			await f.post();
			const ticket = parseTicket(readFileSync(f.ticketPath, 'utf8'));
			if (kind === 'collision') delete ticket.incidentProvenance;
			if (kind === 'scope')
				ticket.incidentProvenance = { ...(ticket.incidentProvenance as object), projectId: 'other-project' };
			if (kind === 'version')
				ticket.incidentProvenance = { ...(ticket.incidentProvenance as object), schemaVersion: 2 };
			if (kind === 'malformed') ticket.incidentProvenance = 'PRIVATE malformed source';
			writeFileSync(f.ticketPath, serializeTicket(ticket));
			const before = readFileSync(f.ticketPath, 'utf8');
			const code = kind === 'version' ? 'unsupported_source_version' : 'provenance_conflict';
			await failure(await f.post(), code, 409);
			await failure(await f.request(), code, 409);
			expect(readFileSync(f.ticketPath, 'utf8')).toBe(before);
			expect(f.files()).toHaveLength(1);
		}
	});

	test('immutable fingerprint/first-seen conflicts do not replace previously triaged work', async () => {
		const f = fixtures();
		await f.post();
		for (const patch of [{ fingerprint: 'error:other:failure' }, { firstSeen: incident.firstSeen - 1 }]) {
			await failure(
				await f.post({ schemaVersion: 1, incident: { ...incident, ...patch } }),
				'provenance_conflict',
				409,
			);
		}
		expect(f.files()).toHaveLength(1);
	});

	test('read/create grants are separate, current, scoped and fail closed without leaking records', async () => {
		const f = fixtures();
		await f.post();
		const valid = f.grant();
		for (const grant of [null, { ...valid, revoked: true }, { ...valid, expiresAt: Date.now() - 1 }]) {
			f.setGrant(grant);
			await failure(await f.request(), 'unauthorized', 401);
			await failure(await f.post(), 'unauthorized', 401);
		}
		for (const patch of [
			{ projectId: 'other' },
			...['tenantId', 'sourceInstanceId', 'appId'].map((key) => ({ scope: { ...scope, [key]: 'other' } })),
		]) {
			f.setGrant({ ...valid, ...patch });
			await failure(await f.request(), 'scope_denied', 403);
			await failure(await f.post(), 'scope_denied', 403);
		}
		f.setGrant({ ...valid, roles: ['read'] });
		await failure(await f.post(), 'role_denied', 403);
		expect((await f.request()).status).toBe(200);
		f.setGrant({ ...valid, roles: ['create'] });
		await failure(await f.request(), 'role_denied', 403);
		expect((await f.post()).status).toBe(200);
		f.setGrant(valid);
		for (const auth of ['', 'Bearer unknown', 'Basic private', 'Bearer token secret'])
			await failure(await f.request('GET', undefined, { authorization: auth }), 'unauthorized', 401);
		expect(f.files()).toHaveLength(1);
	});

	test('strict body keys, identifiers, timestamps, versions and bounded technical fingerprints', async () => {
		const invalid = [
			null,
			[],
			{},
			{ schemaVersion: 1, incident, url: 'http://private.invalid' },
			{ schemaVersion: 1, incident: { ...incident, title: 'caller title' } },
			...['id', 'eventId', 'fingerprint', 'firstSeen', 'lastSeen'].map((key) => ({
				schemaVersion: 1,
				incident: { ...incident, [key]: null },
			})),
			...['bad\nvalue', 'x'.repeat(201), '<script>', 'https://private.invalid/path', 'a b', 'a\u200bb'].map(
				(fingerprint) => ({ schemaVersion: 1, incident: { ...incident, fingerprint } }),
			),
			{ schemaVersion: 1, incident: { ...incident, scope: { ...scope, user: 'caller' } } },
			{ schemaVersion: 1, incident: { ...incident, scope: { ...scope, tenantId: '../private' } } },
			{ schemaVersion: 1, incident: { ...incident, firstSeen: -1 } },
			{ schemaVersion: 1, incident: { ...incident, lastSeen: incident.firstSeen - 1 } },
			{ schemaVersion: 1, incident: { ...incident, lastSeen: Date.now() + 600000 } },
		];
		const f = fixtures();
		for (const body of invalid) await failure(await f.post(body), 'invalid_request', 400);
		for (const schemaVersion of [0, 2, '1', null])
			await failure(await f.post({ schemaVersion, incident }), 'unsupported_version', 400);
		await failure(
			await f.post({ schemaVersion: 1, incident: { ...incident, scope: { ...scope, tenantId: 'unknown' } } }),
			'scope_denied',
			403,
		);
		await failure(
			await f.request('POST', { schemaVersion: 1, incident }, { 'content-type': 'text/plain' }),
			'invalid_request',
			400,
		);
		await failure(await f.request('POST', 'x'.repeat(4097)), 'payload_too_large', 413);
		expect(f.files()).toEqual([]);
	});

	test('malformed raw JSON, streaming size/deadline, raw path/query and unsupported methods are bounded', async () => {
		const f = fixtures();
		for (const body of ['{', '"bad"'])
			await failure(
				await f.app.request(path, {
					method: 'POST',
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
					body,
				}),
				'invalid_request',
				400,
			);
		for (const method of ['PUT', 'DELETE', 'OPTIONS', 'PATCH'])
			await failure(await f.request(method), 'method_not_allowed', 405);
		for (const suffix of ['?project=other', '/extra', '%0a'])
			await failure(
				await f.app.request(path + suffix, { headers: { authorization: `Bearer ${token}` } }),
				'invalid_request',
				400,
			);
		const stream = (large: boolean) =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					if (large) controller.enqueue(new Uint8Array(4097));
				},
			});
		for (const large of [true, false]) {
			const request = new Request(`http://localhost${path}`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: stream(large),
			});
			await failure(await f.app.fetch(request), large ? 'payload_too_large' : 'request_timeout', large ? 413 : 408);
		}
		expect(f.files()).toEqual([]);
	});

	test('authority is rechecked after delayed body and immediately before atomic publication', async () => {
		for (const gate of ['body', 'commit']) {
			const f = fixtures();
			f.onAuthority(() => {
				if (f.calls() === (gate === 'body' ? 2 : 3)) f.setGrant(null);
			});
			await failure(await f.post(), 'unauthorized', 401);
			expect(f.files()).toEqual([]);
		}
	});

	test('mapping changes during authority/body/commit deny both writes and reads', async () => {
		for (const gate of [1, 2, 3]) {
			const f = fixtures();
			f.onAuthority(() => {
				if (f.calls() === gate) f.context.adapters.set(projectId, new FolderAdapter({ dataDir: f.dataDir }));
			});
			await failure(await f.post(), 'mapping_changed', 409);
			expect(f.files()).toEqual([]);
		}
		for (const change of ['marker', 'scope', 'project', 'store', 'authority', 'status']) {
			const f = fixtures();
			await f.post();
			if (change === 'marker')
				writeFileSync(
					join(f.dataDir, '.tickets-store.json'),
					JSON.stringify({ schemaVersion: 1, id: 'other', kind: 'folder' }),
				);
			if (change === 'scope') f.config.allowedScope.tenantId = 'other';
			if (change === 'project') f.config.projectId = 'other';
			if (change === 'store') f.config.dataDir = root;
			if (change === 'authority') f.config.authority = () => f.grant();
			if (change === 'status') f.context.config.statuses.push('new');
			await failure(await f.request(), 'mapping_changed', 409);
			await failure(await f.post(), 'mapping_changed', 409);
			expect(f.files()).toHaveLength(1);
		}
	});

	test('post-commit revocation withholds success; restored authority reconciles one committed ticket', async () => {
		const f = fixtures();
		const valid = f.grant();
		f.onAuthority(() => {
			if (f.calls() === 4) f.setGrant(null);
		});
		await failure(await f.post(), 'unauthorized', 401);
		expect(f.files()).toHaveLength(1);
		f.setGrant(valid);
		const retry = await f.post();
		expect(retry.status).toBe(200);
		expect((await retry.json()).duplicate).toBe(true);
	});

	test('invalid startup mapping/origin/Git/authority never initializes or repairs a store', () => {
		const f = fixtures();
		for (const patch of [
			{ projectId: 'Triage fixture' },
			{ dataDir: join(root, 'missing') },
			{ authority: undefined },
			{ adapter: new GitBranchAdapter({ dataDir: f.dataDir, push: false }) },
			...[
				'http://localhost:6325',
				'http://127.1:6325',
				'http://2130706433:6325',
				'https://example.com',
				'http://127.0.0.1:6325/',
				'http://127.0.0.1:6325/?incident=x',
				'http://user@127.0.0.1:6325',
			].map((hubOrigin) => ({ hubOrigin })),
		])
			expect(() => registerIncidentTriageRoutes(new Hono(), { ...f.config, ...patch } as IncidentTriageConfig)).toThrow(
				'invalid_configuration',
			);
		expect(f.files()).toEqual([]);
		expect(f.forbidden()).toBe(0);
	});

	test('actual loopback HTTP retains local-origin boundary; bearer alone never makes a foreign Origin local', async () => {
		const f = fixtures();
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request, listener) {
				return allowsLocalRequest(request, listener.port)
					? f.app.fetch(request)
					: new Response('Local origin required', { status: 403 });
			},
		});
		try {
			const url = `http://127.0.0.1:${server.port}${path}`;
			const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
			expect(
				(
					await fetch(url, {
						method: 'POST',
						headers: { ...headers, origin: 'http://127.0.0.1:6325' },
						body: JSON.stringify({ schemaVersion: 1, incident }),
					})
				).status,
			).toBe(403);
			expect(f.files()).toEqual([]);
			expect(
				(await fetch(url, { method: 'POST', headers, body: JSON.stringify({ schemaVersion: 1, incident }) })).status,
			).toBe(201);
			expect((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
			await failure(await fetch(url), 'unauthorized', 401);
		} finally {
			await server.stop(true);
		}
	});
});

// One bounded test job, actual separate processes. The authority exits at a precise
// pre/post-commit boundary; no fake adapter or second work-item database participates.
test('separate processes: concurrent publication, lost ACK, death before commit, restart and edited retry', async () => {
	const f = fixtures();
	const appUrl = new URL('../app.ts', import.meta.url).href;
	const contextUrl = new URL('../context.ts', import.meta.url).href;
	const grantFile = join(f.dataDir, 'grant.json');
	writeFileSync(grantFile, JSON.stringify(f.grant()));
	const worker = `
import { readFileSync } from 'node:fs';
import { createApp } from ${JSON.stringify(appUrl)};
import { createContext } from ${JSON.stringify(contextUrl)};
const context = createContext(${JSON.stringify(f.context.config)});
let checks = 0;
const app = createApp(context, { local: true, incidentTriage: {
 projectId: ${JSON.stringify(projectId)}, dataDir: ${JSON.stringify(f.dataDir)},
 adapter: context.adapters.get(${JSON.stringify(projectId)}), allowedScope: ${JSON.stringify(scope)},
 hubOrigin: ${JSON.stringify(f.config.hubOrigin)}, authority(token) {
  checks++;
  if (process.env.TRIAGE_EXIT_GATE && checks === Number(process.env.TRIAGE_EXIT_GATE)) process.exit(73);
  return token === ${JSON.stringify(token)} ? JSON.parse(readFileSync(${JSON.stringify(grantFile)}, 'utf8')) : null;
 }
} });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
console.log(JSON.stringify({ port: server.port }));
process.stdin.on('data', async () => { await server.stop(true); process.exit(0); });
`;
	const spawnWorker = (gate: string) =>
		Bun.spawn([process.execPath, '--eval', worker], {
			cwd: join(import.meta.dir, '../../../..'),
			env: { ...process.env, TRIAGE_EXIT_GATE: gate },
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		});
	const workers: Array<ReturnType<typeof spawnWorker>> = [];
	const start = async (gate = '') => {
		const processHandle = spawnWorker(gate);
		workers.push(processHandle);
		const reader = processHandle.stdout.getReader();
		const ready = await reader.read();
		reader.releaseLock();
		const { port } = JSON.parse(new TextDecoder().decode(ready.value));
		return { processHandle, base: `http://127.0.0.1:${port}` };
	};
	const post = (base: string, value = incident) =>
		fetch(`${base}/api/incident-triage/incidents/${value.id}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ schemaVersion: 1, incident: value }),
		});
	const stop = async (handle: Awaited<ReturnType<typeof start>>) => {
		handle.processHandle.stdin.write('stop\n');
		expect(await handle.processHandle.exited).toBe(0);
	};
	try {
		const first = await start();
		const second = await start();
		const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(i % 2 ? first.base : second.base)));
		expect(results.filter((response) => response.status === 201)).toHaveLength(1);
		expect(results.filter((response) => response.status === 200)).toHaveLength(7);
		for (const response of results) expect((await response.json()).ticket.id).toBe(f.id);
		await stop(first);
		await stop(second);
		const lost = { ...incident, id: '10000000-0000-4000-8000-000000000002' };
		const crashing = await start('4');
		await expect(post(crashing.base, lost)).rejects.toThrow();
		expect(await crashing.processHandle.exited).toBe(73);
		const resumed = await start();
		const recovered = await post(resumed.base, lost);
		expect(recovered.status).toBe(200);
		expect((await recovered.json()).duplicate).toBe(true);
		await stop(resumed);
		const precommit = { ...incident, id: '10000000-0000-4000-8000-000000000003' };
		const beforeCommit = await start('3');
		await expect(post(beforeCommit.base, precommit)).rejects.toThrow();
		expect(await beforeCommit.processHandle.exited).toBe(73);
		expect(f.files().filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
		const final = await start();
		expect((await post(final.base, precommit)).status).toBe(201);
		expect((await post(final.base, precommit)).status).toBe(200);
		await f.adapter.update(f.id, { title: 'After restart owner edit', archived: true });
		const bytes = readFileSync(f.ticketPath, 'utf8');
		expect((await post(final.base)).status).toBe(200);
		expect(readFileSync(f.ticketPath, 'utf8')).toBe(bytes);
		writeFileSync(grantFile, JSON.stringify({ ...f.grant(), revoked: true }));
		await failure(
			await fetch(`${final.base}${path}`, { headers: { authorization: `Bearer ${token}` } }),
			'unauthorized',
			401,
		);
		await failure(await post(final.base), 'unauthorized', 401);
		expect(f.files().filter((name) => name.endsWith('.md'))).toHaveLength(3);
		await stop(final);
	} finally {
		for (const handle of workers) {
			if (handle.exitCode === null) {
				handle.stdin.write('stop\n');
				await handle.exited;
			}
			writeFileSync(join(root, `worker-${handle.pid}-stderr.log`), await new Response(handle.stderr).text());
		}
	}
}, 20000);
