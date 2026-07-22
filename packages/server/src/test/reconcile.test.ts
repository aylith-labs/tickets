import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, type StoreLocation } from '@aylith/tickets-core';
import { reconcileProjects } from '../reconcile';
import { readMarker } from '../store-marker';
import type { DaemonConfig } from '../types/DaemonConfig';
import type { ProjectEntry } from '../types/ProjectEntry';

let rootDir: string;
let storeRoot: string;
let worktreesRoot: string;

const initGitStore = async (dataDir: string): Promise<void> => {
	await mkdir(dataDir, { recursive: true });
	await exec('git', ['init', '-b', 'main'], dataDir);
	await exec('git', ['config', 'user.email', 'tickets@test.local'], dataDir);
	await exec('git', ['config', 'user.name', 'Tickets Test'], dataDir);
	await exec('git', ['commit', '--allow-empty', '--no-verify', '-m', 'init'], dataDir);
};

const buildConfig = (projects: ProjectEntry[]): DaemonConfig => ({
	port: 6320,
	apiBase: 'http://localhost:6320/api',
	statuses: ['todo', 'done'],
	storeRoot,
	worktreesRoot,
	projects,
	terminals: [],
	enrich: { defaultProvider: 'claude-cli', providers: [{ id: 'claude-cli', kind: 'claude-cli' }] },
});

const gitLocation = (dataDir: string): StoreLocation => ({ kind: 'git', scope: 'central', dataDir, branch: 'main' });

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), 'tickets-reconcile-test-'));
	storeRoot = join(rootDir, 'store');
	worktreesRoot = join(rootDir, 'worktrees');
	await mkdir(storeRoot, { recursive: true });
	await mkdir(worktreesRoot, { recursive: true });
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe('reconcileProjects', () => {
	test('mints an id and writes a committed marker for a legacy entry', async () => {
		const dataDir = join(storeRoot, 'legacy-store');
		await initGitStore(dataDir);
		const config = buildConfig([{ name: 'legacy', repoPath: rootDir, location: gitLocation(dataDir) }]);

		const { config: healed, diagnostics } = await reconcileProjects(config);

		expect(healed.projects[0]?.id).toMatch(/^[0-9a-f]{12}$/);
		expect(diagnostics.some((diagnostic) => diagnostic.kind === 'minted-id')).toBe(true);
		const marker = await readMarker(dataDir);
		expect(marker?.id).toBe(healed.projects[0]?.id);
		const { stdout } = await exec('git', ['log', '--format=%s'], dataDir);
		expect(stdout).toContain(`Register tickets store ${healed.projects[0]?.id}`);
	});

	test('re-finds a store by id after it moved and updates dataDir', async () => {
		const originalDir = join(storeRoot, 'original');
		await initGitStore(originalDir);
		let config = buildConfig([{ name: 'moved', repoPath: rootDir, location: gitLocation(originalDir) }]);
		({ config } = await reconcileProjects(config)); // mint id + marker
		const id = config.projects[0]?.id;

		const movedDir = join(storeRoot, 'relocated');
		await rename(originalDir, movedDir);

		const { config: healed, diagnostics } = await reconcileProjects(config);
		expect(healed.projects[0]?.id).toBe(id);
		expect(healed.projects[0]?.location?.dataDir).toBe(movedDir);
		expect(healed.projects[0]?.unavailable).toBeUndefined();
		expect(diagnostics.some((diagnostic) => diagnostic.kind === 'healed-datadir')).toBe(true);
	});

	test('marks an entry unavailable when its store is gone', async () => {
		const config = buildConfig([
			{ id: 'deadbeef0001', name: 'ghost', repoPath: rootDir, location: gitLocation(join(storeRoot, 'never-existed')) },
		]);

		const { config: healed, diagnostics } = await reconcileProjects(config);
		expect(healed.projects[0]?.unavailable).toBe('store folder not found');
		expect(diagnostics.some((diagnostic) => diagnostic.kind === 'store-missing')).toBe(true);
	});
});
