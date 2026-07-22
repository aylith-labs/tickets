import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '@aylith/tickets-core';
import { initProject } from '../init';
import { readDaemonConfig } from '../registry';

let rootDir: string;
let repoPath: string;
let configPath: string;
let storeRoot: string;
let worktreesRoot: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), 'tickets-init-test-'));
	repoPath = join(rootDir, 'demo-app');
	configPath = join(rootDir, 'config.json');
	storeRoot = join(rootDir, 'store');
	worktreesRoot = join(rootDir, 'worktrees');
	await mkdir(repoPath, { recursive: true });
	await exec('git', ['init', '-b', 'main'], repoPath);
	await exec('git', ['config', 'user.email', 'tickets@test.local'], repoPath);
	await exec('git', ['config', 'user.name', 'Tickets Test'], repoPath);
	await writeFile(join(repoPath, 'README.md'), '# demo\n', 'utf8');
	await exec('git', ['add', '.'], repoPath);
	await exec('git', ['commit', '--no-verify', '-m', 'init'], repoPath);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

const init = (overrides: Record<string, unknown> = {}) =>
	initProject({ cwd: repoPath, configPath, storeRoot, worktreesRoot, ...overrides });

describe('initProject', () => {
	test('repo-git creates a relocated orphan worktree under worktreesRoot and registers a stable id', async () => {
		const entry = await init();
		expect(entry.name).toBe('demo-app');
		expect(entry.id).toMatch(/^[0-9a-f]{12}$/);
		expect(entry.location?.kind).toBe('git');
		expect(entry.location?.scope).toBe('repo');
		const dataDir = entry.location?.dataDir ?? '';
		expect(dataDir).toBe(join(worktreesRoot, `demo-app-${entry.id?.slice(0, 6)}`));

		await access(join(dataDir, '.git'));
		const { stdout: branch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dataDir);
		expect(branch.trim()).toBe('tickets');

		// Orphan: the data branch shares no history with main.
		const { stdout: mainRev } = await exec('git', ['rev-parse', 'main'], repoPath);
		const { stdout: log } = await exec('git', ['log', '--format=%H'], dataDir);
		expect(log).not.toContain(mainRev.trim());

		// The store is self-describing (committed marker carries the id).
		await access(join(dataDir, '.tickets-store.json'));

		const config = await readDaemonConfig(configPath);
		expect(config.projects.length).toBe(1);
		expect(config.projects[0]?.id).toBe(entry.id);
		expect(config.projects[0]?.location?.dataDir).toBe(dataDir);
	});

	test('re-init in the same repo reuses one store and only refreshes the name', async () => {
		const first = await init();
		const second = await init({ name: 'renamed' });
		expect(second.name).toBe('renamed');
		expect(second.id).toBe(first.id);
		expect(second.location?.dataDir).toBe(first.location?.dataDir);

		const config = await readDaemonConfig(configPath);
		expect(config.projects.length).toBe(1);
		expect(config.projects[0]?.name).toBe('renamed');
	});

	test('repo-folder uses an in-repo .tickets dir and skips git plumbing', async () => {
		const entry = await init({ into: 'repo-folder' });
		expect(entry.location?.kind).toBe('folder');
		expect(entry.location?.scope).toBe('repo');
		expect(entry.location?.dataDir).toBe(join(repoPath, '.tickets'));
	});

	test('central-git puts the project in one shared store repo', async () => {
		const entry = await init({ into: 'central-git' });
		expect(entry.location?.kind).toBe('git');
		expect(entry.location?.scope).toBe('central');
		const dataDir = entry.location?.dataDir ?? '';
		expect(dataDir).toBe(join(storeRoot, `demo-app-${entry.id?.slice(0, 6)}`));

		await access(join(storeRoot, '.git')); // ONE shared repo at the store root
		await access(join(dataDir, 'tickets'));
		const { stdout } = await exec('git', ['log', '--format=%s'], storeRoot);
		expect(stdout).toContain(`Register tickets store ${entry.id}`);
	});
});
