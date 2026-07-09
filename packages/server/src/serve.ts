import { watch } from 'node:fs';
import { join } from 'node:path';
import { TICKETS_DIR } from '@aylith/tickets-core';
import { createApp } from './app';
import { createContext, type ServerContext } from './context';
import { readDaemonConfig } from './registry';

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
	const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 });
	console.log(`tickets daemon listening on http://localhost:${config.port} (${config.projects.length} project(s))`);
	return server;
};
