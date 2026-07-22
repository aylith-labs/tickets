import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKETS_DIR } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from './app';
import { createContext, type ServerContext } from './context';
import { reconcileProjects } from './reconcile';
import { projectLocation, readDaemonConfig } from './registry';

const WEB_DIST_DIR = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.map': 'application/json',
	'.svg': 'image/svg+xml',
};

/** Asset name → file path. The compiled binary passes embedded paths; otherwise on-disk. */
export type WebAssets = Record<string, string>;

/**
 * Central UI: single-segment assets, index.html for everything else. Assets
 * resolve from the embedded map (standalone binary) or the on-disk build dir.
 */
const registerStaticUi = (app: Hono, webAssets?: WebAssets): void => {
	const resolveAsset = (assetName: string): string => webAssets?.[assetName] ?? join(WEB_DIST_DIR, assetName);
	app.get('*', async (c) => {
		const pathname = new URL(c.req.url).pathname;
		// basename() collapses any traversal attempt to a plain filename.
		const name = basename(pathname).includes('.') ? basename(pathname) : 'index.html';
		const file = Bun.file(resolveAsset(name));
		if (!(await file.exists())) {
			return c.text('tickets daemon is running; the web UI is not built (run: bun run build:web)', 404);
		}
		const extension = name.slice(name.lastIndexOf('.'));
		return new Response(file, { headers: { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' } });
	});
};

const watchProjects = (context: ServerContext): void => {
	for (const project of context.config.projects) {
		const dataDir = projectLocation(project).dataDir;
		let debounce: ReturnType<typeof setTimeout> | undefined;
		try {
			watch(join(dataDir, TICKETS_DIR), () => {
				clearTimeout(debounce);
				debounce = setTimeout(() => context.events.emit('tickets-updated'), 300);
			});
		} catch {
			// The tickets/ dir may not exist until the first ticket — watch the data dir instead.
			try {
				watch(dataDir, () => {
					clearTimeout(debounce);
					debounce = setTimeout(() => context.events.emit('tickets-updated'), 300);
				});
			} catch (error) {
				console.warn(`tickets: cannot watch ${dataDir}:`, error instanceof Error ? error.message : error);
			}
		}
	}
};

export const startDaemon = async (options: { configPath?: string; port?: number; webAssets?: WebAssets } = {}) => {
	const initialConfig = await readDaemonConfig(options.configPath);
	const { config, diagnostics } = await reconcileProjects(initialConfig, {
		persist: true,
		configPath: options.configPath,
	});
	for (const diagnostic of diagnostics) {
		if (diagnostic.kind === 'store-missing')
			console.warn(`tickets: project "${diagnostic.name}" — ${diagnostic.reason}`);
		else if (diagnostic.kind === 'adoptable')
			console.warn(`tickets: unregistered store at ${diagnostic.path} (run: tickets adopt ${diagnostic.path})`);
	}
	if (options.port) config.port = options.port;
	const context = createContext(config);
	watchProjects(context);
	const app = createApp(context);
	registerStaticUi(app, options.webAssets);
	const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 });
	console.log(`tickets daemon listening on http://localhost:${config.port} (${config.projects.length} project(s))`);
	return server;
};
