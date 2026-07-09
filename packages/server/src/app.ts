import { composePrompt, type StorageAdapter, type TicketPatch } from '@aylith/tickets-core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { ServerContext } from './context';
import { runStatusChangeHook } from './hooks';
import { buildLaunchCommand } from './launch';
import type { ProjectEntry } from './types/ProjectEntry';

const isAllowedOrigin = (origin: string): boolean => {
	try {
		const { hostname } = new URL(origin);
		return (
			hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'lvh.me' || hostname.endsWith('.lvh.me')
		);
	} catch {
		return false;
	}
};

type ResolvedProject = { project: ProjectEntry; adapter: StorageAdapter };

export const createApp = (context: ServerContext): Hono => {
	const app = new Hono();

	// Covers /api/* and the /components.js bundle — embedded pages on other
	// *.lvh.me apps fetch the components module cross-origin (CORS-mode).
	app.use('*', cors({ origin: (origin) => (isAllowedOrigin(origin) ? origin : undefined) }));

	const resolveProject = (name: string): ResolvedProject | null => {
		const project = context.config.projects.find((entry) => entry.name === name);
		const adapter = context.adapters.get(name);
		return project && adapter ? { project, adapter } : null;
	};

	app.get('/api/projects', (c) =>
		c.json({
			projects: context.config.projects.map(({ name, repoPath, adapter }) => ({ name, repoPath, adapter })),
			statuses: context.config.statuses,
			terminals: context.config.terminals.map(({ id, label }) => ({ id, label })),
			enrichProviders: context.config.enrich.providers.map(({ id }) => id),
			apiBase: context.config.apiBase,
		}),
	);

	app.get('/api/tickets', async (c) => {
		const projectFilter = c.req.query('project');
		const includeArchived = c.req.query('archived') === 'true';
		const projects = projectFilter
			? context.config.projects.filter(({ name }) => name === projectFilter)
			: context.config.projects;
		if (projectFilter && projects.length === 0) return c.json({ error: `Unknown project ${projectFilter}` }, 404);
		const lists = await Promise.all(
			projects.map(async ({ name }) => {
				const adapter = context.adapters.get(name);
				if (!adapter) return [];
				const tickets = await adapter.list();
				return tickets.map((ticket) => ({ ...ticket, project: name }));
			}),
		);
		const tickets = lists.flat().filter((ticket) => includeArchived || !ticket.archived);
		return c.json({ tickets });
	});

	app.post('/api/tickets', async (c) => {
		const body = await c.req.json<Record<string, unknown>>().catch(() => null);
		if (!body || typeof body.project !== 'string' || typeof body.title !== 'string' || body.title.trim().length === 0) {
			return c.json({ error: 'project and title are required' }, 400);
		}
		const resolved = resolveProject(body.project);
		if (!resolved) return c.json({ error: `Unknown project ${body.project}` }, 404);
		const ticket = await resolved.adapter.create({
			title: body.title.trim(),
			description: typeof body.description === 'string' ? body.description : undefined,
		});
		context.events.emit('tickets-updated');
		return c.json({ ...ticket, project: resolved.project.name }, 201);
	});

	app.get('/api/tickets/:project/:id', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const ticket = await resolved.adapter.get(c.req.param('id'));
		if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
		return c.json({ ...ticket, project: resolved.project.name });
	});

	app.patch('/api/tickets/:project/:id', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const id = c.req.param('id');
		const current = await resolved.adapter.get(id);
		if (!current) return c.json({ error: 'Ticket not found' }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => null);
		if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

		const patch: TicketPatch = {};
		if (typeof body.title === 'string' && body.title.trim().length > 0) patch.title = body.title.trim();
		if (typeof body.description === 'string') patch.description = body.description;
		if (typeof body.archived === 'boolean') patch.archived = body.archived;
		if (typeof body.status === 'string') {
			if (!context.config.statuses.includes(body.status)) {
				return c.json({ error: `Unknown status ${body.status}. Valid: ${context.config.statuses.join(', ')}` }, 400);
			}
			patch.status = body.status;
		}
		if (Object.keys(patch).length === 0) return c.json({ error: 'No updatable fields in body' }, 400);

		const message =
			patch.status && Object.keys(patch).length === 1 ? `Transition ticket ${id} to ${patch.status}` : undefined;
		const updated = await resolved.adapter.update(id, patch, message);
		if (patch.status && patch.status !== current.status) {
			runStatusChangeHook(context.config.onStatusChange, resolved.project.name, updated, current.status, patch.status);
		}
		context.events.emit('tickets-updated');
		return c.json({ ...updated, project: resolved.project.name });
	});

	app.post('/api/tickets/:project/:id/archive', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const ticket = await resolved.adapter.get(c.req.param('id'));
		if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
		const archived = await resolved.adapter.archive(ticket.id);
		context.events.emit('tickets-updated');
		return c.json({ ...archived, project: resolved.project.name });
	});

	app.get('/api/tickets/:project/:id/prompt', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.text('Unknown project', 404);
		const ticket = await resolved.adapter.get(c.req.param('id'));
		if (!ticket) return c.text('Ticket not found', 404);
		const prompt = composePrompt(
			ticket,
			{ name: resolved.project.name, repoPath: resolved.project.repoPath },
			{ apiBase: context.config.apiBase, template: context.config.promptTemplate },
		);
		return c.text(prompt, 200, { 'content-type': 'text/plain; charset=utf-8' });
	});

	app.post('/api/tickets/:project/:id/launch', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const id = c.req.param('id');
		const ticket = await resolved.adapter.get(id);
		if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const terminalId = typeof body.terminal === 'string' ? body.terminal : context.config.terminals[0]?.id;
		const terminal = context.config.terminals.find((entry) => entry.id === terminalId);
		if (!terminal) return c.json({ error: `Unknown terminal ${terminalId}` }, 400);

		const apiBase = context.config.apiBase.replace(/\/$/, '');
		const command = buildLaunchCommand(terminal.command, {
			repoPath: resolved.project.repoPath,
			promptUrl: `${apiBase}/tickets/${resolved.project.name}/${id}/prompt`,
		});
		context.runCommand(command);

		let updated = ticket;
		if (ticket.status !== 'in_progress' && context.config.statuses.includes('in_progress')) {
			updated = await resolved.adapter.update(id, { status: 'in_progress' }, `Transition ticket ${id} to in_progress`);
			runStatusChangeHook(context.config.onStatusChange, resolved.project.name, updated, ticket.status, 'in_progress');
			context.events.emit('tickets-updated');
		}
		return c.json({ launched: true, terminal: terminal.id, ticket: { ...updated, project: resolved.project.name } });
	});

	app.post('/api/tickets/:project/:id/enrich', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const id = c.req.param('id');
		const ticket = await resolved.adapter.get(id);
		if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const providerId = typeof body.provider === 'string' ? body.provider : context.config.enrich.defaultProvider;
		const provider = context.config.enrich.providers.find((entry) => entry.id === providerId);
		if (!provider) return c.json({ error: `Unknown enrich provider ${providerId}` }, 400);

		try {
			const result = await context.enrich(ticket, provider);
			const updated = await resolved.adapter.update(
				id,
				{ title: result.title, description: result.description },
				`Enrich ticket ${id}`,
			);
			context.events.emit('tickets-updated');
			return c.json({ ...updated, project: resolved.project.name });
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Enrich failed' }, 502);
		}
	});

	app.get('/api/tickets/:project/:id/revisions', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const revisions = await resolved.adapter.getRevisions(c.req.param('id'));
		return c.json({ revisions });
	});

	app.get('/api/tickets/:project/:id/revisions/:ref', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const revision = await resolved.adapter.getRevision(c.req.param('id'), c.req.param('ref'));
		if (!revision) return c.json({ error: 'Revision not found' }, 404);
		return c.json({ ...revision, project: resolved.project.name });
	});

	app.post('/api/tickets/:project/:id/revisions/:ref/restore', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		try {
			const restored = await resolved.adapter.restoreRevision(c.req.param('id'), c.req.param('ref'));
			context.events.emit('tickets-updated');
			return c.json({ ...restored, project: resolved.project.name });
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Restore failed' }, 400);
		}
	});

	app.post('/api/tickets/:project/:id/attachments', async (c) => {
		const resolved = resolveProject(c.req.param('project'));
		if (!resolved) return c.json({ error: 'Unknown project' }, 404);
		const id = c.req.param('id');
		const ticket = await resolved.adapter.get(id);
		if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
		if (!context.config.media) return c.json({ error: 'Media storage is not configured' }, 503);

		const body = await c.req.parseBody();
		const file = body.file;
		if (!(file instanceof File)) return c.json({ error: 'Multipart field "file" is required' }, 400);
		const kind = body.kind === 'before' || body.kind === 'after' ? body.kind : 'other';
		const label = typeof body.label === 'string' && body.label.length > 0 ? body.label : undefined;

		try {
			const attachment = await context.publishMedia({
				media: context.config.media,
				projectName: resolved.project.name,
				ticketId: id,
				filename: file.name,
				kind,
				label,
				data: new Uint8Array(await file.arrayBuffer()),
			});
			const updated = await resolved.adapter.update(
				id,
				{ attachments: [...ticket.attachments, attachment] },
				`Attach ${kind} media to ticket ${id}`,
			);
			context.events.emit('tickets-updated');
			return c.json({ ...updated, project: resolved.project.name, attachment }, 201);
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Upload failed' }, 502);
		}
	});

	app.get('/api/events', (c) =>
		streamSSE(c, async (stream) => {
			const unsubscribe = context.events.subscribe((event) => {
				void stream.writeSSE({ event: 'change', data: event });
			});
			stream.onAbort(() => unsubscribe());
			while (!stream.aborted) {
				await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
				await stream.sleep(15000);
			}
		}),
	);

	return app;
};
