import type { StorageAdapter } from '@aylith/tickets-core';
import type { Context, Hono } from 'hono';
import type { ServerContext } from './context';

const CAPABILITY = 'tickets-ticket';
const TICKET_ID = /^[0-9]{1,16}$/;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const isProjectId = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.length <= 1000 &&
	value !== '.' &&
	value !== '..' &&
	!/[\\/]/.test(value) &&
	!CONTROL.test(value);

const ERRORS = {
	invalid_request: 400,
	project_not_found: 404,
	ticket_not_found: 404,
	method_not_allowed: 405,
	invalid_configuration: 409,
	mapping_changed: 409,
	source_unavailable: 503,
	invalid_source: 502,
} as const;
type ErrorCode = keyof typeof ERRORS;
type Failure = { error: ErrorCode };

type Snapshot = {
	config: ServerContext['config'];
	projects: ServerContext['config']['projects'];
	project: ServerContext['config']['projects'][number];
	location: unknown;
	identity: string;
	statuses: string[];
	adapters: ServerContext['adapters'];
	adapter: StorageAdapter;
	get: StorageAdapter['get'];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;

/** Only inspect the in-memory source configuration; never resolve paths or repair legacy entries. */
const snapshot = (context: ServerContext, projectId: string): Snapshot | Failure => {
	try {
		const config = context.config;
		if (!isRecord(config) || !Array.isArray(config.projects) || !Array.isArray(config.statuses)) {
			return { error: 'invalid_configuration' };
		}
		const statuses = [...config.statuses];
		if (!statuses.length || !statuses.every(isStatus) || new Set(statuses).size !== statuses.length) {
			return { error: 'invalid_configuration' };
		}
		// Unrelated legacy/unavailable entries confer no authority and must not deny
		// a healthy explicitly mapped source. Only exact target ID matches participate.
		const matches = config.projects.filter((entry) => isRecord(entry) && entry.id === projectId);
		if (matches.length > 1) return { error: 'invalid_configuration' };
		const project = matches[0];
		if (!project) return { error: 'project_not_found' };
		if (typeof project.name !== 'string' || typeof project.repoPath !== 'string') {
			return { error: 'invalid_configuration' };
		}
		if (project.unavailable !== undefined) {
			return {
				error:
					typeof project.unavailable === 'string' && project.unavailable.length > 0
						? 'source_unavailable'
						: 'invalid_configuration',
			};
		}
		const location = project.location;
		if (
			(location !== undefined &&
				(!isRecord(location) ||
					!['folder', 'git'].includes(location.kind) ||
					!['repo', 'central'].includes(location.scope) ||
					typeof location.dataDir !== 'string' ||
					(location.remote !== undefined && typeof location.remote !== 'string') ||
					(location.branch !== undefined && typeof location.branch !== 'string') ||
					(location.pushEnabled !== undefined && typeof location.pushEnabled !== 'boolean'))) ||
			(project.adapter !== undefined && !['folder', 'git'].includes(project.adapter)) ||
			(project.dataDir !== undefined && typeof project.dataDir !== 'string')
		) {
			return { error: 'invalid_configuration' };
		}
		// Copy mapping values as well as references to catch edits made in place during get().
		const identity = JSON.stringify([
			project.id,
			project.name,
			project.repoPath,
			project.adapter,
			project.dataDir,
			location?.kind,
			location?.scope,
			location?.dataDir,
			location?.remote,
			location?.branch,
			location?.pushEnabled,
		]);
		const adapters = context.adapters;
		if (!(adapters instanceof Map)) return { error: 'source_unavailable' };
		const adapter = adapters.get(projectId);
		if (!adapter || typeof adapter.get !== 'function') return { error: 'source_unavailable' };
		return {
			config,
			projects: config.projects,
			project,
			location,
			identity,
			statuses,
			adapters,
			adapter,
			get: adapter.get,
		};
	} catch {
		return { error: 'invalid_configuration' };
	}
};

const sameMapping = (before: Snapshot, after: Snapshot): boolean =>
	before.config === after.config &&
	before.projects === after.projects &&
	before.project === after.project &&
	before.location === after.location &&
	before.identity === after.identity &&
	before.adapters === after.adapters &&
	before.adapter === after.adapter &&
	before.get === after.get &&
	before.statuses.length === after.statuses.length &&
	before.statuses.every((status, index) => status === after.statuses[index]);

/** Preserve source ISO timestamps rather than normalizing their precision or timezone. */
const isTimestamp = (value: unknown): value is string => {
	return (
		typeof value === 'string' &&
		value.length <= 40 &&
		/^\d{4}-\d\d-\d\dT/.test(value) &&
		Number.isFinite(Date.parse(value))
	);
};

const ticketSnapshot = (value: unknown, ticketId: string, statuses: string[]) => {
	if (!isRecord(value)) return null;
	// Do not spread the source object: attachments, paths and custom serialization stay private.
	const { id, title, description, status, archived, created, updated } = value;
	if (
		id !== ticketId ||
		typeof title !== 'string' ||
		!title.trim() ||
		title.length > 10000 ||
		typeof description !== 'string' ||
		description.length > 10000 ||
		typeof status !== 'string' ||
		!statuses.includes(status) ||
		typeof archived !== 'boolean' ||
		!isTimestamp(created) ||
		(updated !== undefined && (!isTimestamp(updated) || Date.parse(updated) < Date.parse(created)))
	) {
		return null;
	}
	return { id: ticketId, title, description, status, archived, created, ...(updated === undefined ? {} : { updated }) };
};

const fail = (c: Context, code: ErrorCode) =>
	c.json({ schemaVersion: 1, capability: CAPABILITY, error: { code } }, ERRORS[code]);

/**
 * Local authless daemon read capability, not tenant authorization. Ayla must retain
 * its verified caller/grant boundary. Register before CORS so OPTIONS cannot bypass GET-only.
 */
export const registerSuiteContextRoutes = (app: Hono, context: ServerContext): void => {
	app.all('/api/suite/projects/:rest{[\\s\\S]*}', async (c) => {
		// Hono decodes path characters before routing; inspect the raw encoded pathname
		// here so encoded newlines cannot miss a wildcard route and lose the error envelope.
		const pathname = new URL(c.req.url).pathname;
		c.header('Cache-Control', 'no-store');
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('Allow', 'GET');
		if (c.req.method !== 'GET') return fail(c, 'method_not_allowed');
		let projectId: string;
		let ticketId: string;
		try {
			const match = /^\/api\/suite\/projects\/([^/]+)\/tickets\/([^/]+)$/.exec(pathname);
			if (!match?.[1] || !match[2]) return fail(c, 'invalid_request');
			projectId = decodeURIComponent(match[1]);
			ticketId = decodeURIComponent(match[2]);
			if (!isProjectId(projectId) || !TICKET_ID.test(ticketId)) return fail(c, 'invalid_request');
		} catch {
			return fail(c, 'invalid_request');
		}
		const before = snapshot(context, projectId);
		if ('error' in before) return fail(c, before.error);
		let value: unknown;
		let readFailed = false;
		try {
			value = await before.get.call(before.adapter, ticketId);
		} catch {
			readFailed = true;
		}
		let ticket: ReturnType<typeof ticketSnapshot> = null;
		try {
			if (!readFailed && value !== null) ticket = ticketSnapshot(value, ticketId, before.statuses);
		} catch {
			// Source accessors are untrusted too; never return their exception text.
		}
		const after = snapshot(context, projectId);
		if ('error' in after) return fail(c, after.error);
		if (!sameMapping(before, after)) return fail(c, 'mapping_changed');
		if (readFailed) return fail(c, 'source_unavailable');
		if (value === null) return fail(c, 'ticket_not_found');
		if (!ticket) return fail(c, 'invalid_source');
		return c.json({ schemaVersion: 1, capability: CAPABILITY, project: { id: projectId }, ticket });
	});
};
