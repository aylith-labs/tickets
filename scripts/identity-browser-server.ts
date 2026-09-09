import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_STATUSES } from '../packages/core/src/index';
import { createApp } from '../packages/server/src/app';
import { createContext } from '../packages/server/src/context';

// Isolated real folder storage/API; never reads the owner's daemon configuration.
const root = await mkdtemp(join(tmpdir(), 'aylith-tickets-browser-'));
const context = createContext(
	{
		port: 57610,
		apiBase: 'http://127.0.0.1:57610/api',
		statuses: [...DEFAULT_STATUSES],
		storeRoot: root,
		worktreesRoot: root,
		projects: [
			{
				id: 'synthetic-stable-01',
				name: 'Renamed synthetic project',
				repoPath: root,
				adapter: 'folder',
				dataDir: root,
			},
		],
		terminals: [],
		enrich: { defaultProvider: '', providers: [] },
	},
	{
		runCommand: () => {
			throw new Error('Agent launching disabled in regression server');
		},
		enrich: async () => {
			throw new Error('Paid enrichment disabled in regression server');
		},
		publishMedia: async () => {
			throw new Error('External publishing disabled in regression server');
		},
	},
);
const app = createApp(context);
app.get('*', (c) => {
	const name = new URL(c.req.url).pathname;
	const file = name === '/main.js' ? 'main.js' : name === '/components.js' ? 'components.js' : 'index.html';
	return new Response(Bun.file(resolve(import.meta.dirname, '../apps/web/dist', file)), {
		headers: { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' },
	});
});
Bun.serve({ hostname: '127.0.0.1', port: 57610, fetch: app.fetch, idleTimeout: 0 });
console.log(`Synthetic identity browser server ready; retained store: ${root}`);
