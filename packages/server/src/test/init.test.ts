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

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), 'tickets-init-test-'));
	repoPath = join(rootDir, 'demo-app');
	configPath = join(rootDir, 'config.json');
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

describe('initProject', () => {
	test('creates the orphan tickets branch as a sibling worktree and registers the project', async () => {
		const entry = await initProject({ cwd: repoPath, configPath });
		expect(entry.name).toBe('demo-app');
		expect(entry.adapter).toBe('git');
		expect(entry.dataDir).toBe(join(rootDir, 'demo-app.worktrees', 'tickets'));

		await access(join(entry.dataDir, '.git'));

		const { stdout: branch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], entry.dataDir);
		expect(branch.trim()).toBe('tickets');

		// Orphan: the data branch shares no history with main.
		const { stdout: mainRev } = await exec('git', ['rev-parse', 'main'], repoPath);
		const { stdout: log } = await exec('git', ['log', '--format=%H'], entry.dataDir);
		expect(log).not.toContain(mainRev.trim());

		const config = await readDaemonConfig(configPath);
		expect(config.projects).toEqual([entry]);
	});

	test('is idempotent and honors --name', async () => {
		await initProject({ cwd: repoPath, configPath });
		const second = await initProject({ cwd: repoPath, configPath, name: 'renamed' });
		expect(second.name).toBe('renamed');
		const config = await readDaemonConfig(configPath);
		expect(config.projects.length).toBe(2); // demo-app + renamed (same repo, different names)
	});

	test('folder adapter uses an in-repo .tickets dir and skips git plumbing', async () => {
		const entry = await initProject({ cwd: repoPath, configPath, adapter: 'folder' });
		expect(entry.dataDir).toBe(join(repoPath, '.tickets'));
	});
});
