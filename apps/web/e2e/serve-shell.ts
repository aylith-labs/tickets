import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { DEFAULT_STATUSES } from '../../../packages/core/src/index';
import { createApp } from '../../../packages/server/src/app';
import { createContext } from '../../../packages/server/src/context';

// Real Tickets API + FolderAdapter, configured explicitly without daemon config,
// repository data, launchers, enrichment providers, media or status-change hooks.
const root = await mkdtemp(join(tmpdir(), 'aylith-tickets-shell-'));
const context = createContext(
	{
		port: 5184,
		apiBase: 'http://127.0.0.1:5184/api',
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
		runCommand() {
			throw new Error('Agent launching disabled in isolated harness');
		},
		async enrich() {
			throw new Error('Enrichment disabled in isolated harness');
		},
		async publishMedia() {
			throw new Error('Publishing disabled in isolated harness');
		},
	},
);
const app = createApp(context);
const webDist = resolve(import.meta.dirname, '../dist');
const remoteRoot = resolve(import.meta.dirname, '../../../../aylith-shell/apps/remote/dist');
const enabled = process.env.TICKETS_SHELL_ENABLED !== '0';
const types: Record<string, string> = {
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.woff2': 'font/woff2',
	'.html': 'text/html',
};
app.get('*', async (c) => {
	const name = new URL(c.req.url).pathname;
	if (name.startsWith('/api/')) return c.json({ error: 'Unknown API endpoint' }, 404);
	const file = name === '/main.js' ? 'main.js' : name === '/components.js' ? 'components.js' : 'index.html';
	let body = await readFile(join(webDist, file));
	if (file === 'index.html') {
		let html = body.toString();
		if (enabled)
			html = html
				.replace(
					'name="aylith-shell-manifest" content=""',
					'name="aylith-shell-manifest" content="http://127.0.0.1:5185/mf-manifest.json"',
				)
				.replace('name="aylith-shell-enabled" content="false"', 'name="aylith-shell-enabled" content="true"');
		html = html.replace(
			'<div class="shell">',
			'<div class="shell"><p role="note">Synthetic local API and folder-storage fixture. No live account or project linkage.</p>',
		);
		body = Buffer.from(html);
	}
	return new Response(body, { headers: { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' } });
});
const web = Bun.serve({ hostname: '127.0.0.1', port: 5184, fetch: app.fetch, idleTimeout: 0 });
const remote = Bun.serve({
	hostname: '127.0.0.1',
	port: 5185,
	async fetch(request) {
		try {
			const pathname = decodeURIComponent(new URL(request.url).pathname);
			const file = resolve(remoteRoot, `.${pathname}`);
			if (!file.startsWith(remoteRoot + sep)) return new Response(null, { status: 404 });
			let body = await readFile(file);
			const extension = extname(file);
			if (['.js', '.json', '.css', '.html'].includes(extension)) {
				body = Buffer.from(body.toString().replaceAll('http://localhost:5180/', 'http://127.0.0.1:5185/'));
			}
			return new Response(body, {
				headers: {
					'content-type': types[extension] ?? 'application/octet-stream',
					'Access-Control-Allow-Origin': 'http://127.0.0.1:5184',
				},
			});
		} catch {
			return new Response('Fixture asset unavailable', { status: 404 });
		}
	},
});
const close = () => {
	web.stop(true);
	remote.stop(true);
	process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
console.log(`Isolated Tickets API on 5184; read-only shell preview on 5185; retained synthetic store: ${root}`);
