import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { exec, FolderAdapter, GitBranchAdapter } from '@aylith/tickets-core';
import { parseServeOptions } from '../cli-run';
import { createContext } from '../context';
import { provisionStore } from '../init';
import { localStartupConfig } from '../local-startup';
import { readDaemonConfig, writeDaemonConfig } from '../registry';
import { startDaemon } from '../serve';
import { MARKER_FILE, writeMarker } from '../store-marker';
import type { DaemonConfig } from '../types/DaemonConfig';
import type { ProjectEntry } from '../types/ProjectEntry';

let root: string;
let configPath: string;
let config: DaemonConfig;
const servers: Awaited<ReturnType<typeof startDaemon>>[] = [];

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'tickets-local-startup-'));
	configPath = join(root, 'config.json');
	config = {
		port: 6320,
		apiBase: 'http://localhost:6320/api',
		statuses: ['todo', 'done'],
		storeRoot: join(root, 'store'),
		worktreesRoot: join(root, 'worktrees'),
		projects: [],
		terminals: [],
		enrich: { defaultProvider: '', providers: [] },
	};
});

afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.stopWatching();
		await server.stop(true);
	}
	if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('tickets-local-startup-')) {
		throw new Error('Refusing cleanup outside the test temporary directory');
	}
	await rm(root, { recursive: true, force: true });
});

const addStore = async (id: string, kind: 'folder' | 'git' = 'folder'): Promise<ProjectEntry> => {
	const dataDir = join(root, id);
	await mkdir(dataDir);
	await writeMarker(dataDir, { schemaVersion: 1, id, kind, name: 'same name', createdAt: '2026-09-08T00:00:00Z' });
	const project: ProjectEntry = {
		id,
		name: 'same name',
		repoPath: dataDir,
		location: { kind, scope: 'repo', dataDir, ...(kind === 'git' ? { pushEnabled: true } : {}) },
	};
	config.projects.push(project);
	return project;
};

const start = async (projectIds: string[]) => {
	await writeDaemonConfig(config, configPath);
	const server = await startDaemon({ configPath, local: true, projectIds, port: 0 });
	servers.push(server);
	return server;
};

describe('strict serve CLI options', () => {
	test('default serve and valid port retain their existing options', () => {
		expect(parseServeOptions([])).toEqual({});
		expect(parseServeOptions(['--port', '52804'])).toEqual({ port: 52804 });
	});
	test('collects exact project IDs with explicit local mode', () => {
		expect(
			parseServeOptions(['--project-id', 'abc123', '--local', '--project-id', 'def456', '--port', '52804']),
		).toEqual({
			local: true,
			projectIds: ['abc123', 'def456'],
			port: 52804,
		});
	});
	for (const args of [
		['--local'],
		['--project-id', 'abc123'],
		['--local', '--project-id'],
		['--local', '--project-id', '--port', '52804'],
		['--local', '--project', 'abc123'],
		['--port'],
		['--port', '52804junk'],
		['--port', '1.5'],
		['--port', '0'],
		['--port', '65536'],
		['--port', '6320', '--port', '6321'],
		['--local', '--local', '--project-id', 'abc123'],
		['--host', '0.0.0.0'],
	]) {
		test(`rejects invalid scope/bind arguments: ${args.join(' ')}`, () => {
			expect(() => parseServeOptions(args)).toThrow();
		});
	}
});

describe('local selection without reconciliation', () => {
	test('selects exact IDs despite duplicate names, without reading unselected storage metadata', async () => {
		await addStore('first');
		await addStore('second');
		config.projects.push({
			id: 'unselected',
			name: 'same name',
			repoPath: root,
			get location(): never {
				throw new Error('Unselected storage accessed');
			},
		});
		const scoped = await localStartupConfig(config, ['second', 'first']);
		expect(scoped.projects.map((project) => project.id)).toEqual(['second', 'first']);
		expect(config.projects).toHaveLength(3);
	});
	test('rejects empty, repeated, missing, name-only and ambiguous selections', async () => {
		const project = await addStore('first');
		for (const ids of [[], [' '], ['first', 'first'], ['first', 'missing'], ['same name']]) {
			await expect(localStartupConfig(config, ids)).rejects.toThrow();
		}
		config.projects.push({ ...project });
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('exactly one');
	});
	test('malformed location values fail before storage access or config writes', async () => {
		const project = await addStore('first');
		const original = project.location;
		for (const patch of [
			{ kind: 'unknown' },
			{ scope: 'unknown' },
			{ dataDir: '../relative' },
			{ pushEnabled: 'true' },
			{ branch: 5 },
			{ branch: '' },
			{ remote: 5 },
		]) {
			project.location = Object.assign({}, original, patch);
			await expect(localStartupConfig(config, ['first'])).rejects.toThrow('invalid storage configuration');
		}
		project.location = original;
		project.repoPath = '../relative';
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('invalid storage configuration');
		expect(await Bun.file(configPath).exists()).toBe(false);
		expect(await readdir(join(root, 'first'))).toEqual([MARKER_FILE]);
	});
	test.each(['missing', 'malformed', 'wrong-id', 'wrong-kind', 'wrong-version'])(
		'rejects %s store markers without repair',
		async (failure) => {
			const project = await addStore('first');
			const markerPath = join(root, 'first', MARKER_FILE);
			if (failure === 'missing') await rm(markerPath);
			else {
				await writeFile(
					markerPath,
					failure === 'malformed'
						? '{'
						: JSON.stringify({
								schemaVersion: failure === 'wrong-version' ? 2 : 1,
								id: failure === 'wrong-id' ? 'second' : project.id,
								kind: failure === 'wrong-kind' ? 'git' : 'folder',
							}),
				);
			}
			const before = await readFile(markerPath, 'utf8').catch(() => null);
			await expect(localStartupConfig(config, ['first'])).rejects.toThrow('matching store marker');
			expect(await readFile(markerPath, 'utf8').catch(() => null)).toBe(before);
		},
	);
	test('rejects an unavailable project and a broken Git store without creating anything', async () => {
		const project = await addStore('first', 'git');
		project.unavailable = 'store folder not found';
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('marked unavailable');
		delete project.unavailable;
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('working Git store');
		expect(await readdir(join(root, 'first'))).toEqual([MARKER_FILE]);
	});
	test('does not retain externally executing actions in the local runtime or change their saved configuration', async () => {
		await addStore('first');
		config.terminals = [{ id: 'terminal', label: 'terminal', command: 'must not execute' }];
		config.enrich = { defaultProvider: 'provider', providers: [{ id: 'provider', kind: 'claude-cli' }] };
		config.media = { repoPath: join(root, 'media'), baseUrl: 'https://invalid.example', pathPrefix: 'tickets' };
		config.onStatusChange = 'must not execute';
		const before = JSON.stringify(config);
		const scoped = await localStartupConfig(config, ['first']);
		expect(scoped.terminals).toEqual([]);
		expect(scoped.enrich.providers).toEqual([]);
		expect(scoped.media).toBeUndefined();
		expect(scoped.onStatusChange).toBeUndefined();
		expect(JSON.stringify(config)).toBe(before);
	});
	test('rejects a nested repo directory, wrong branch and detached HEAD without Git repair', async () => {
		const project = await addStore('first', 'git');
		const dataDir = join(root, 'first');
		await exec('git', ['init', '--template=', '-b', 'tickets'], root);
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('configured root and branch');
		await exec('git', ['init', '--template=', '-b', 'tickets'], dataDir);
		await exec('git', ['config', 'user.name', 'Tickets Test'], dataDir);
		await exec('git', ['config', 'user.email', 'tickets@test.local'], dataDir);
		await exec('git', ['config', 'commit.gpgsign', 'false'], dataDir);
		await exec('git', ['add', '--', MARKER_FILE], dataDir);
		await exec('git', ['commit', '--no-verify', '-m', 'seed marker'], dataDir);
		if (!project.location) throw new Error('Missing fixture location');
		project.location.branch = 'other-branch';
		const before = (await exec('git', ['rev-parse', 'HEAD'], dataDir)).stdout;
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('configured root and branch');
		project.location.branch = 'tickets';
		expect((await localStartupConfig(config, ['first'])).projects[0]?.id).toBe('first');
		await exec('git', ['checkout', '--detach'], dataDir);
		await expect(localStartupConfig(config, ['first'])).rejects.toThrow('configured root and branch');
		expect((await exec('git', ['rev-parse', 'HEAD'], dataDir)).stdout).toBe(before);
	});
	test('accepts a selected central Git subfolder only under its configured central root', async () => {
		const project = await addStore('central-selected', 'git');
		const location = await provisionStore({
			setup: 'central-git',
			repoPath: root,
			storeRoot: config.storeRoot,
			worktreesRoot: config.worktreesRoot,
			subdir: 'central-selected',
		});
		const dataDir = location.dataDir;
		await writeMarker(dataDir, {
			schemaVersion: 1,
			id: 'central-selected',
			kind: 'git',
			name: 'Central',
			createdAt: '',
		});
		project.location = location;
		expect(location.branch).toBe('main');
		expect((await localStartupConfig(config, ['central-selected'])).projects[0]?.location?.pushEnabled).toBe(false);
		config.storeRoot = root;
		await expect(localStartupConfig(config, ['central-selected'])).rejects.toThrow('configured root and branch');
	});
	test('canonical central Git serves and edits one selected subfolder without traversing its committed sibling', async () => {
		for (const id of ['central-selected', 'central-excluded']) {
			const location = await provisionStore({
				setup: 'central-git',
				repoPath: root,
				storeRoot: config.storeRoot,
				worktreesRoot: config.worktreesRoot,
				subdir: id,
			});
			await writeMarker(location.dataDir, { schemaVersion: 1, id, kind: 'git', name: id, createdAt: '' });
			await new FolderAdapter({ dataDir: location.dataDir }).create({
				title: id === 'central-excluded' ? 'Private central sentinel content' : id,
			});
			config.projects.push({ id, name: id, repoPath: root, location });
		}
		await exec('git', ['config', 'commit.gpgsign', 'false'], config.storeRoot);
		await exec('git', ['add', '.'], config.storeRoot);
		await exec('git', ['commit', '--no-verify', '-m', 'seed two central stores'], config.storeRoot);
		const sentinelPath = join(config.storeRoot, 'central-excluded', 'tickets', '0001.md');
		const sentinel = await readFile(sentinelPath, 'utf8');
		const server = await start(['central-selected']);
		const base = `http://127.0.0.1:${server.port}/api/tickets/central-selected`;
		for (const rawId of ['../../central-excluded/tickets/0001', '..\\..\\central-excluded\\tickets\\0001']) {
			const id = encodeURIComponent(rawId);
			for (const suffix of ['', '/revisions', '/revisions/HEAD', '/revisions/HEAD/restore']) {
				const response = await fetch(`${base}/${id}${suffix}`, { method: suffix.endsWith('restore') ? 'POST' : 'GET' });
				const body = await response.text();
				expect(body).not.toContain('Private central sentinel content');
				if (suffix === '/revisions') expect(JSON.parse(body).revisions).toEqual([]);
				else expect(response.status).toBeGreaterThanOrEqual(400);
			}
		}
		const updated = await fetch(`${base}/0001`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: 'selected central update' }),
		});
		expect(updated.status).toBe(200);
		await updated.text();
		const revisions = await (await fetch(`${base}/0001/revisions`)).json();
		expect(revisions.revisions).toHaveLength(2);
		const restored = await fetch(`${base}/0001/revisions/${revisions.revisions[1].ref}/restore`, { method: 'POST' });
		expect(restored.status).toBe(200);
		expect((await restored.json()).title).toBe('central-selected');
		expect(await readFile(sentinelPath, 'utf8')).toBe(sentinel);
		expect((await exec('git', ['status', '--porcelain'], config.storeRoot)).stdout).toBe('');
	});
});

describe('actual local daemon', () => {
	test('encoded ticket IDs cannot read or mutate an excluded sibling through a selected project', async () => {
		await addStore('first');
		await addStore('excluded');
		const excludedDir = join(root, 'excluded');
		await new FolderAdapter({ dataDir: excludedDir }).create({ title: 'Excluded sentinel ticket' });
		const path = join(excludedDir, 'tickets', '0001.md');
		const before = await readFile(path, 'utf8');
		const server = await start(['first']);
		const base = `http://127.0.0.1:${server.port}`;
		for (const id of ['../../excluded/tickets/0001', '..\\..\\excluded\\tickets\\0001']) {
			const ticketPath = `/api/tickets/first/${encodeURIComponent(id)}`;
			for (const [method, suffix] of [
				['GET', ''],
				['PATCH', ''],
				['GET', '/revisions'],
				['GET', '/revisions/HEAD'],
				['POST', '/revisions/HEAD/restore'],
			]) {
				const response = await fetch(`${base}${ticketPath}${suffix}`, {
					method,
					...(method === 'GET'
						? {}
						: { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Must not escape' }) }),
				});
				const body = await response.text();
				expect(body).not.toContain('Excluded sentinel ticket');
				if (suffix !== '/revisions') expect(response.status).toBeGreaterThanOrEqual(400);
			}
		}
		expect(await readFile(path, 'utf8')).toBe(before);
	});
	test('serves only selected stores on loopback, keeps registry/other stores intact, and restarts normally', async () => {
		await addStore('first');
		const unselected = await addStore('unselected');
		delete unselected.id; // Normal reconciliation would mint an ID and rewrite config.
		const markerPath = join(root, 'unselected', MARKER_FILE);
		await rm(markerPath);
		const sentinelPath = join(root, 'unselected', 'sentinel.txt');
		await writeFile(sentinelPath, 'Unrelated data must remain byte-for-byte unchanged.\n');
		await new FolderAdapter({ dataDir: join(root, 'unselected') }).create({ title: 'Excluded sentinel ticket' });
		const sentinelTicket = await readFile(join(root, 'unselected', 'tickets', '0001.md'), 'utf8');
		const server = await start(['first']);
		expect(server.hostname).toBe('127.0.0.1');
		const savedConfig = await readFile(configPath, 'utf8');
		const base = `http://127.0.0.1:${server.port}`;
		const metadata = await (await fetch(`${base}/api/projects`)).json();
		expect(metadata.projects.map((project: ProjectEntry) => project.id)).toEqual(['first']);
		expect((await fetch(`${base}/api/tickets?project=unselected`)).status).toBe(404);
		expect(
			(
				await fetch(`${base}/api/tickets`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ project: 'unselected', title: 'must not write' }),
				})
			).status,
		).toBe(404);
		const created = await fetch(`${base}/api/tickets`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: 'first', title: 'selected record' }),
		});
		expect(created.status).toBe(201);
		const ticket = await created.json();
		server.stopWatching();
		await server.stop(true);
		servers.splice(servers.indexOf(server), 1);
		const restarted = await startDaemon({ configPath, local: true, projectIds: ['first'], port: 0 });
		servers.push(restarted);
		const restored = await (await fetch(`http://127.0.0.1:${restarted.port}/api/tickets/first/${ticket.id}`)).json();
		expect(restored.title).toBe('selected record');
		expect(restored.projectId).toBe('first');
		expect(await readFile(configPath, 'utf8')).toBe(savedConfig);
		expect((await readdir(join(root, 'unselected'))).sort()).toEqual(['sentinel.txt', 'tickets']);
		expect(await readFile(sentinelPath, 'utf8')).toBe('Unrelated data must remain byte-for-byte unchanged.\n');
		expect(await readFile(join(root, 'unselected', 'tickets', '0001.md'), 'utf8')).toBe(sentinelTicket);
		expect(await Bun.file(markerPath).exists()).toBe(false);
		expect(await Bun.file(config.storeRoot).exists()).toBe(false);
	});
	test('rejects invalid programmatic scope before any normal reconciliation', async () => {
		await expect(startDaemon({ configPath, projectIds: ['first'], port: 0 })).rejects.toThrow('requires --local');
		await expect(startDaemon({ configPath, local: true, port: 0 })).rejects.toThrow('requires at least one');
		expect(await Bun.file(configPath).exists()).toBe(false);
	});
	test('HTTP writes cannot add/remove projects, alter settings, push, execute actions or reach an excluded store', async () => {
		await addStore('first');
		await addStore('excluded');
		const excludedDir = join(root, 'excluded');
		await new FolderAdapter({ dataDir: excludedDir }).create({ title: 'Excluded sentinel ticket' });
		const excludedBefore = await readFile(join(excludedDir, 'tickets', '0001.md'), 'utf8');
		config.onStatusChange = 'must not execute';
		config.terminals = [{ id: 'terminal', label: 'terminal', command: 'must not execute' }];
		config.enrich = { defaultProvider: 'provider', providers: [{ id: 'provider', kind: 'claude-cli' }] };
		const server = await start(['first']);
		const registryBefore = await readFile(configPath, 'utf8');
		const base = `http://127.0.0.1:${server.port}`;
		const request = (method: string, path: string, body: unknown = {}) =>
			fetch(`${base}${path}`, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
		for (const path of [
			'/api/projects',
			'/api/projects/first',
			'/api/projects/excluded',
			'/api/register',
			'/api/init',
			'/api/adopt',
			'/api/reconcile',
			'/api/discover',
			'/api/settings',
			'/api/config',
			'/api/migrate',
			'/api/converge',
		]) {
			for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
				const response = await request(method, path, {
					project: 'excluded',
					projectIds: ['excluded'],
					projects: config.projects,
					location: { pushEnabled: true },
					pushEnabled: true,
					local: false,
				});
				expect(response.status).toBe(404);
				await response.text();
			}
		}
		for (const [method, suffix] of [
			['PATCH', ''],
			['POST', '/archive'],
			['POST', '/launch'],
			['POST', '/enrich'],
			['POST', '/attachments'],
			['POST', '/revisions/HEAD/restore'],
		]) {
			const response = await request(method ?? '', `/api/tickets/excluded/0001${suffix}`, { status: 'done' });
			expect(response.status).toBe(404);
			await response.text();
		}
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect((await request(method, '/api/suite/projects/excluded/tickets/0001')).status).toBe(405);
		}
		expect((await fetch(`${base}/api/suite/projects/excluded/tickets/0001`)).status).toBe(404);
		const created = await (await request('POST', '/api/tickets', { project: 'first', title: 'Local edit' })).json();
		const ticketPath = `/api/tickets/first/${created.id}`;
		const changed = await request('PATCH', ticketPath, {
			status: 'done',
			project: 'excluded',
			projectIds: ['excluded'],
			location: { dataDir: excludedDir, pushEnabled: true },
			pushEnabled: true,
		});
		expect(changed.status).toBe(200);
		expect((await changed.json()).projectId).toBe('first');
		for (const suffix of ['/launch', '/enrich', '/attachments']) {
			expect(
				(await request('POST', `${ticketPath}${suffix}`, { terminal: 'terminal', provider: 'provider' })).status,
			).toBe(suffix === '/attachments' ? 503 : 400);
		}
		const metadata = await (await fetch(`${base}/api/projects`)).json();
		expect(metadata.projects.map((project: ProjectEntry) => project.id)).toEqual(['first']);
		expect(metadata.terminals).toEqual([]);
		expect(metadata.enrichProviders).toEqual([]);
		expect(
			(await (await fetch(`${base}/api/tickets`)).json()).tickets.map(
				(ticket: { projectId: string }) => ticket.projectId,
			),
		).toEqual(['first']);
		expect(await readFile(configPath, 'utf8')).toBe(registryBefore);
		expect(await readFile(join(excludedDir, 'tickets', '0001.md'), 'utf8')).toBe(excludedBefore);
		expect(await readdir(join(excludedDir, 'tickets'))).toEqual(['0001.md']);
	});
	test('keeps Git commits local even when saved configuration enables pushes', async () => {
		await addStore('git-selected', 'git');
		const dataDir = join(root, 'git-selected');
		await exec('git', ['init', '--template=', '-b', 'tickets'], dataDir);
		await exec('git', ['config', 'user.name', 'Tickets Test'], dataDir);
		await exec('git', ['config', 'user.email', 'tickets@test.local'], dataDir);
		await exec('git', ['config', 'commit.gpgsign', 'false'], dataDir);
		await exec('git', ['add', '--', MARKER_FILE], dataDir);
		await exec('git', ['commit', '--no-verify', '-m', 'seed marker'], dataDir);
		const remote = join(root, 'local-remote.git');
		await exec('git', ['init', '--template=', '--bare', remote], root);
		await exec('git', ['remote', 'add', 'origin', remote], dataDir);
		await writeDaemonConfig(config, configPath);
		const before = await readFile(configPath, 'utf8');
		const scoped = await localStartupConfig(await readDaemonConfig(configPath), ['git-selected']);
		const adapter = createContext(scoped).adapters.get('git-selected');
		if (!(adapter instanceof GitBranchAdapter)) throw new Error('Expected actual Git adapter');
		const server = await startDaemon({ configPath, local: true, projectIds: ['git-selected'], port: 0 });
		servers.push(server);
		const base = `http://127.0.0.1:${server.port}`;
		const created = await fetch(`${base}/api/tickets`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: 'git-selected', title: 'Local Git record', pushEnabled: true }),
		});
		expect(created.status).toBe(201);
		const ticket = await created.json();
		await adapter.flush(); // Await all queued work so a deferred push cannot escape the assertion/cleanup.
		expect((await exec('git', ['log', '-1', '--format=%s'], dataDir)).stdout.trim()).toBe(`Create ticket ${ticket.id}`);
		expect((await exec('git', ['for-each-ref'], remote)).stdout).toBe('');
		expect(await readFile(configPath, 'utf8')).toBe(before);
		expect(config.projects[0]?.location?.pushEnabled).toBe(true);
		expect(scoped.projects[0]?.location?.pushEnabled).toBe(false);
		const metadata = await (await fetch(`${base}/api/projects`)).json();
		expect(metadata.projects[0].location.pushEnabled).toBe(false);
		const revisions = await (await fetch(`${base}/api/tickets/git-selected/${ticket.id}/revisions`)).json();
		expect(revisions.revisions).toHaveLength(1);
		const restored = await fetch(
			`${base}/api/tickets/git-selected/${ticket.id}/revisions/${revisions.revisions[0].ref}/restore`,
			{ method: 'POST' },
		);
		expect(restored.status).toBe(200);
		await restored.text();
		await adapter.flush();
		expect((await exec('git', ['for-each-ref'], remote)).stdout).toBe('');
		for (const id of ['../../excluded/tickets/0001', '..\\..\\excluded\\tickets\\0001', ':(top)0001']) {
			expect(await adapter.get(id)).toBeNull();
			expect(await adapter.getRevisions(id)).toEqual([]);
			expect(await adapter.getRevision(id, 'HEAD')).toBeNull();
			await expect(adapter.restoreRevision(id, 'HEAD')).rejects.toThrow();
		}
		for (const ref of ['--output=escaped', 'HEAD:../excluded']) {
			expect(await adapter.getRevision(ticket.id, ref)).toBeNull();
		}
	});
});
