import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
	createIncidentTicket,
	FolderAdapter,
	hasIncidentKeys,
	type IncidentInput,
	IncidentPersistenceError,
	type IncidentScope,
	incidentScopeKey,
	isIncidentInput,
	isIncidentRecord,
	isIncidentScope,
	isIncidentUuid,
	readIncidentTicket,
} from '@aylith/tickets-core';
import type { Context, Hono } from 'hono';
import type { ServerContext } from './context';

export type { IncidentInput, IncidentScope } from '@aylith/tickets-core';
export type IncidentTriageGrant = {
	scope: IncidentScope;
	projectId: string;
	roles: readonly ('read' | 'create')[];
	expiresAt: number;
	revoked?: boolean;
};
/** Must return current authority synchronously; no cached grant, env or account fallback. */
export type IncidentTriageAuthority = (token: string) => IncidentTriageGrant | null;
export type IncidentTriageConfig = {
	context: ServerContext;
	projectId: string;
	/** Exact native FolderAdapter already mapped in context; subclasses (including Git) are unsupported. */
	adapter: FolderAdapter;
	/** Existing absolute folder with tickets/ and a matching .tickets-store.json; never initialized or repaired. */
	dataDir: string;
	allowedScope: IncidentScope;
	hubOrigin: string;
	authority: IncidentTriageAuthority;
};
export type IncidentTriageOptions = Omit<IncidentTriageConfig, 'context'>;
export type IncidentTriageEnvelope = {
	schemaVersion: 1;
	projectId: string;
	ticket: null | { id: string; title: string; status: string; created: string };
	duplicate?: boolean;
};

const ERRORS = {
	invalid_request: 400,
	unsupported_version: 400,
	unauthorized: 401,
	role_denied: 403,
	scope_denied: 403,
	method_not_allowed: 405,
	request_timeout: 408,
	invalid_configuration: 409,
	mapping_changed: 409,
	provenance_conflict: 409,
	unsupported_source_version: 409,
	payload_too_large: 413,
	invalid_source: 502,
	source_unavailable: 503,
} as const;
type ErrorCode = keyof typeof ERRORS;
class Rejection extends Error {
	constructor(readonly code: ErrorCode) {
		super(code);
	}
}
function reject(code: ErrorCode): never {
	throw new Rejection(code);
}
const fail = (c: Context, code: ErrorCode) => c.json({ schemaVersion: 1, error: { code } }, ERRORS[code]);
const projectIdValid = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,999}$/.test(value);
const originValid = (value: unknown): value is string => {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return (
			url.origin === value && url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password
		);
	} catch {
		return false;
	}
};

/** Snapshot source-owned mapping and the existing folder identity; inspect no unrelated store. */
const mapping = (config: IncidentTriageConfig) => {
	const { context, projectId, adapter, dataDir, allowedScope, hubOrigin, authority } = config;
	if (
		!projectIdValid(projectId) ||
		!isIncidentScope(allowedScope) ||
		!originValid(hubOrigin) ||
		typeof authority !== 'function' ||
		typeof dataDir !== 'string' ||
		!isAbsolute(dataDir) ||
		!(adapter instanceof FolderAdapter) ||
		Object.getPrototypeOf(adapter) !== FolderAdapter.prototype
	)
		reject('invalid_configuration');
	const projects = context.config.projects.filter((entry) => entry.id === projectId);
	const project = projects[0];
	const location = project?.location;
	const adapterState = adapter as unknown as { dataDir: string; ticketsDir: string; defaultStatus: string };
	if (
		projects.length !== 1 ||
		!project ||
		project.unavailable !== undefined ||
		!location ||
		location.kind !== 'folder' ||
		!['repo', 'central'].includes(location.scope) ||
		location.dataDir !== dataDir ||
		context.adapters.get(projectId) !== adapter ||
		adapterState.dataDir !== dataDir ||
		adapterState.ticketsDir !== join(dataDir, 'tickets') ||
		!Array.isArray(context.config.statuses) ||
		!context.config.statuses.length ||
		!context.config.statuses.every((status) => typeof status === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(status)) ||
		!context.config.statuses.includes(adapterState.defaultStatus)
	)
		reject('invalid_configuration');
	const directories = [dataDir, join(dataDir, 'tickets')].map((path) => {
		const stat = lstatSync(path);
		if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(realpathSync(path)) !== resolve(path))
			reject('invalid_configuration');
		return [stat.dev, stat.ino];
	});
	const markerPath = join(dataDir, '.tickets-store.json');
	const markerStat = lstatSync(markerPath);
	if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 16384) reject('invalid_configuration');
	const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
	if (!isIncidentRecord(marker) || marker.schemaVersion !== 1 || marker.id !== projectId || marker.kind !== 'folder')
		reject('invalid_configuration');
	return {
		context,
		daemon: context.config,
		projects: context.config.projects,
		project,
		location,
		adapters: context.adapters,
		adapter,
		authority,
		identity: JSON.stringify([
			project,
			dataDir,
			allowedScope,
			hubOrigin,
			context.config.statuses,
			adapterState.defaultStatus,
			directories,
			marker,
		]),
		status: adapterState.defaultStatus,
	};
};
type Mapping = ReturnType<typeof mapping>;
const sameMapping = (before: Mapping, after: Mapping): boolean =>
	before.context === after.context &&
	before.daemon === after.daemon &&
	before.projects === after.projects &&
	before.project === after.project &&
	before.location === after.location &&
	before.adapters === after.adapters &&
	before.adapter === after.adapter &&
	before.authority === after.authority &&
	before.identity === after.identity;

const tokenFrom = (request: Request): string => {
	const header = request.headers.get('authorization');
	const match = header && /^Bearer ([a-zA-Z0-9._~+/-]{1,512}=*)$/.exec(header);
	return match?.[1] ?? reject('unauthorized');
};
const currentGrant = (config: IncidentTriageConfig, token: string, role: 'read' | 'create'): void => {
	let grant: unknown;
	try {
		grant = config.authority(token);
	} catch {
		reject('unauthorized');
	}
	if (
		!isIncidentRecord(grant) ||
		grant.revoked === true ||
		(grant.revoked !== undefined && grant.revoked !== false) ||
		!Number.isSafeInteger(grant.expiresAt) ||
		(grant.expiresAt as number) <= Date.now()
	)
		reject('unauthorized');
	if (
		!Array.isArray(grant.roles) ||
		!grant.roles.every((item) => item === 'read' || item === 'create') ||
		!grant.roles.includes(role)
	)
		reject('role_denied');
	if (
		!isIncidentScope(grant.scope) ||
		!isIncidentScope(config.allowedScope) ||
		grant.projectId !== config.projectId ||
		incidentScopeKey(grant.scope) !== incidentScopeKey(config.allowedScope)
	)
		reject('scope_denied');
};

const readBody = async (request: Request): Promise<unknown> => {
	if (
		!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') ||
		request.headers.has('content-encoding') ||
		!request.body
	)
		reject('invalid_request');
	const length = request.headers.get('content-length');
	if (length !== null && !/^(0|[1-9][0-9]*)$/.test(length)) reject('invalid_request');
	if (length !== null && Number(length) > 4096) reject('payload_too_large');
	const reader = request.body.getReader();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, rejectPromise) => {
		timer = setTimeout(() => rejectPromise(new Rejection('request_timeout')), 1500);
	});
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await Promise.race([reader.read(), timeout]);
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 4096) reject('payload_too_large');
			chunks.push(value);
		}
		if (length !== null && Number(length) !== bytes) reject('invalid_request');
		const body = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		try {
			return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
		} catch {
			return reject('invalid_request');
		}
	} finally {
		clearTimeout(timer);
		void reader.cancel().catch(() => undefined);
	}
};

/** Explicit opt-in only. Register before wildcard/CORS/static handlers. The host retains its local-origin middleware. */
export const registerIncidentTriageRoutes = (app: Hono, config: IncidentTriageConfig): void => {
	let baseline: Mapping;
	try {
		baseline = mapping(config);
	} catch {
		throw new Error('invalid_configuration');
	}
	const verifyMapping = () => {
		try {
			if (!sameMapping(baseline, mapping(config))) reject('mapping_changed');
		} catch {
			reject('mapping_changed');
		}
	};
	app.all('/api/incident-triage/:rest{[\\s\\S]*}', async (c) => {
		c.header('Cache-Control', 'no-store');
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('Allow', 'GET, POST');
		try {
			if (!['GET', 'POST'].includes(c.req.method)) reject('method_not_allowed');
			const role = c.req.method === 'POST' ? 'create' : 'read';
			const token = tokenFrom(c.req.raw);
			const guard = () => {
				verifyMapping();
				currentGrant(config, token, role);
				// The injected authority may itself update the source mapping.
				verifyMapping();
			};
			guard();
			const url = new URL(c.req.url);
			const id = /^\/api\/incident-triage\/incidents\/([^/]+)$/.exec(url.pathname)?.[1];
			if (url.search || !isIncidentUuid(id)) reject('invalid_request');
			let incident: IncidentInput | undefined;
			if (role === 'create') {
				const body = await readBody(c.req.raw);
				guard();
				if (!isIncidentRecord(body) || !hasIncidentKeys(body, ['schemaVersion', 'incident'])) reject('invalid_request');
				if (body.schemaVersion !== 1) reject('unsupported_version');
				if (!isIncidentInput(body.incident) || body.incident.id !== id || body.incident.lastSeen > Date.now() + 300_000)
					reject('invalid_request');
				if (incidentScopeKey(body.incident.scope) !== incidentScopeKey(config.allowedScope)) reject('scope_denied');
				incident = body.incident;
			} else if (c.req.raw.body || Number(c.req.header('content-length') ?? 0) !== 0) reject('invalid_request');
			const target = {
				dataDir: config.dataDir,
				projectId: config.projectId,
				scope: config.allowedScope,
				incidentId: id,
				hubOrigin: config.hubOrigin,
			};
			const result = incident
				? createIncidentTicket(target, incident, baseline.status, guard)
				: { ticket: readIncidentTicket(target), duplicate: true };
			guard();
			if (incident && !result.duplicate) config.context.events.emit('tickets-updated');
			guard();
			const envelope: IncidentTriageEnvelope = {
				schemaVersion: 1,
				projectId: config.projectId,
				ticket: result.ticket
					? {
							id: result.ticket.id,
							title: result.ticket.title,
							status: result.ticket.status,
							created: result.ticket.created,
						}
					: null,
				...(incident ? { duplicate: result.duplicate } : {}),
			};
			return c.json(envelope, incident && !result.duplicate ? 201 : 200);
		} catch (error) {
			// Denial also cancels unconsumed malformed/unauthorized bodies; never wait on a hostile stream.
			if (!c.req.raw.body?.locked) void c.req.raw.body?.cancel().catch(() => undefined);
			return fail(
				c,
				error instanceof Rejection || error instanceof IncidentPersistenceError ? error.code : 'source_unavailable',
			);
		}
	});
};
