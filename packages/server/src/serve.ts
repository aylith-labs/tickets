import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKETS_DIR } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from './app';
import { createContext, type ServerContext } from './context';
import { readDaemonConfig } from './registry';

const WEB_DIST_DIR = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.map': 'application/json',
	'.svg': 'image/svg+xml',
};

/** Central UI: single-segment assets from apps/web/dist, index.html for everything else. */
const registerStaticUi = (app: Hono): void => {
	app.get('*', async (c) => {
		const pathname = new URL(c.req.url).pathname;
		// basename() collapses any traversal attempt to a plain filename.
		const assetName = basename(pathname);
		const candidate = assetName.includes('.') ? join(WEB_DIST_DIR, assetName) : join(WEB_DIST_DIR, 'index.html');
		const file = Bun.file(candidate);
		if (!(await file.exists())) {
			return c.text('tickets daemon is running; the web UI is not built (run: bun run build:web)', 404);
		}
		const extension = candidate.slice(candidate.lastIndexOf('.'));
		return new Response(file, { headers: { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' } });
	});
};

const watchProjects = (context: ServerContext): void => {
	for (const project of context.config.projects) {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		try {
			watch(join(project.dataDir, TICKETS_DIR), () => {
				clearTimeout(debounce);
				debounce = setTimeout(() => context.events.emit('tickets-updated'), 300);
			});
		} catch {
			// The tickets/ dir may not exist until the first ticket — watch the data dir instead.
			try {
				watch(project.dataDir, () => {
					clearTimeout(debounce);
					debounce = setTimeout(() => context.events.emit('tickets-updated'), 300);
				});
			} catch (error) {
				console.warn(`tickets: cannot watch ${project.dataDir}:`, error instanceof Error ? error.message : error);
			}
		}
	}
};

export const startDaemon = async (options: { configPath?: string; port?: number } = {}) => {
	const config = await readDaemonConfig(options.configPath);
	if (options.port) config.port = options.port;
	const context = createContext(config);
	watchProjects(context);
	const app = createApp(context);
	registerStaticUi(app);
	const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 });
	console.log(`tickets daemon listening on http://localhost:${config.port} (${config.projects.length} project(s))`);
	return server;
};
