import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKETS_DIR } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from './app';
import { createContext, type ServerContext } from './context';
import { allowsLocalRequest } from './local-request';
import { localStartupConfig } from './local-startup';
import { reconcileProjects } from './reconcile';
import { projectLocation, readDaemonConfig } from './registry';

// Both src/serve.ts (Bun export) and dist/*.js resolve inside this package.
// npm consumers do not have the monorepo's apps/web directory.
const WEB_DIST_DIR = fileURLToPath(new URL('../dist/web', import.meta.url));

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

/** Watches every project's store; returns a disposer that releases the watchers and pending timers. */
const watchProjects = (context: ServerContext): (() => void) => {
	const disposers: Array<() => void> = [];
	for (const project of context.config.projects) {
		const dataDir = projectLocation(project).dataDir;
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const onChange = () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => context.events.emit('tickets-updated'), 300);
		};
		// The tickets/ dir may not exist until the first ticket — fall back to the data dir.
		let watcher: ReturnType<typeof watch>;
		try {
			watcher = watch(join(dataDir, TICKETS_DIR), onChange);
		} catch {
			try {
				watcher = watch(dataDir, onChange);
			} catch (error) {
				console.warn(`tickets: cannot watch ${dataDir}:`, error instanceof Error ? error.message : error);
				continue;
			}
		}
		disposers.push(() => {
			clearTimeout(debounce);
			watcher.close();
		});
	}
	return () => {
		for (const dispose of disposers) dispose();
		disposers.length = 0;
	};
};

export type DaemonOptions = {
	configPath?: string;
	port?: number;
	webAssets?: WebAssets;
	/** Loopback, exact existing IDs, no reconciliation/config writes or adapter pushes. */
	local?: boolean;
	projectIds?: string[];
};

export const startDaemon = async (options: DaemonOptions = {}) => {
	if (options.projectIds !== undefined && !options.local) throw new Error('--project-id requires --local');
	if (options.local && !options.projectIds?.length) throw new Error('--local requires at least one exact --project-id');
	const initialConfig = await readDaemonConfig(options.configPath);
	const { config, diagnostics } = options.local
		? { config: await localStartupConfig(initialConfig, options.projectIds ?? []), diagnostics: [] }
		: await reconcileProjects(initialConfig, { persist: true, configPath: options.configPath });
	for (const diagnostic of diagnostics) {
		if (diagnostic.kind === 'store-missing')
			console.warn(`tickets: project "${diagnostic.name}" — ${diagnostic.reason}`);
		else if (diagnostic.kind === 'adoptable')
			console.warn(`tickets: unregistered store at ${diagnostic.path} (run: tickets adopt ${diagnostic.path})`);
	}
	if (options.port !== undefined) config.port = options.port;
	const context = createContext(config);
	const stopWatching = watchProjects(context);
	try {
		const app = createApp(context, { local: options.local });
		registerStaticUi(app, options.webAssets);
		const server = Bun.serve({
			port: config.port,
			...(options.local ? { hostname: '127.0.0.1' } : {}),
			fetch(request, listener) {
				if (options.local && !allowsLocalRequest(request, listener.port)) {
					return Response.json(
						{ error: 'This local daemon only accepts requests from its own origin' },
						{
							status: 403,
							headers: { 'cache-control': 'no-store' },
						},
					);
				}
				return app.fetch(request);
			},
			idleTimeout: 0,
		});
		console.log(
			`tickets daemon listening on http://${options.local ? '127.0.0.1' : 'localhost'}:${server.port} (${config.projects.length} project(s))`,
		);
		return Object.assign(server, { stopWatching });
	} catch (error) {
		stopWatching();
		throw error;
	}
};
