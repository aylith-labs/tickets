import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '@aylith/tickets-core';
import { initProject } from '../init';
import { adoptStore, convergeProjects, migrateProject, renameProject } from '../migrate';
import { createAdapter, readDaemonConfig, writeDaemonConfig } from '../registry';
import { readMarker } from '../store-marker';

let rootDir: string;
let configPath: string;
let storeRoot: string;
let worktreesRoot: string;

const makeRepo = async (name: string): Promise<string> => {
	const repo = join(rootDir, name);
	await mkdir(repo, { recursive: true });
	await exec('git', ['init', '-b', 'main'], repo);
	await exec('git', ['config', 'user.email', 't@t'], repo);
	await exec('git', ['config', 'user.name', 't'], repo);
	await writeFile(join(repo, 'README.md'), `# ${name}\n`, 'utf8');
	await exec('git', ['add', '.'], repo);
	await exec('git', ['commit', '--no-verify', '-m', 'init'], repo);
	return repo;
};

const exists = (path: string): Promise<boolean> =>
	access(path).then(
		() => true,
		() => false,
	);

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), 'tickets-srv-migrate-'));
	configPath = join(rootDir, 'config.json');
	storeRoot = join(rootDir, 'store');
	worktreesRoot = join(rootDir, 'worktrees');
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe('migrate + converge + rename', () => {
	test('converge moves every per-repo project into one central store', async () => {
		const alpha = await makeRepo('alpha');
		const beta = await makeRepo('beta');
		await initProject({ cwd: alpha, name: 'alpha', into: 'repo-git', configPath, storeRoot, worktreesRoot });
		await initProject({ cwd: beta, name: 'beta', into: 'repo-folder', configPath, storeRoot, worktreesRoot });

		const seeded = await readDaemonConfig(configPath);
		for (const project of seeded.projects) await createAdapter(project).create({ title: `${project.name} ticket` });

		const outcomes = await convergeProjects({ setup: 'central-git', configPath, storeRoot, worktreesRoot });
		expect(outcomes.length).toBe(2);
		expect(outcomes.every((outcome) => outcome.copied === 1)).toBe(true);

		await access(join(storeRoot, '.git')); // ONE shared store repo
		const after = await readDaemonConfig(configPath);
		for (const project of after.projects) {
			expect(project.location?.scope).toBe('central');
			expect(project.location?.dataDir.startsWith(storeRoot)).toBe(true);
			const tickets = await createAdapter(project).list();
			expect(tickets.length).toBe(1);
		}
	});

	test('relocate moves a per-repo worktree in place, keeping the branch', async () => {
		const worktreesA = join(rootDir, 'wtA');
		const worktreesB = join(rootDir, 'wtB');
		const repo = await makeRepo('gamma');
		const entry = await initProject({
			cwd: repo,
			name: 'gamma',
			into: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot: worktreesA,
		});
		const oldDir = entry.location?.dataDir ?? '';
		await access(join(oldDir, '.git'));

		const outcome = await migrateProject({
			selector: 'gamma',
			to: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot: worktreesB,
		});
		expect(outcome.moved).toBe(true);
		expect(outcome.to.dataDir.startsWith(worktreesB)).toBe(true);
		expect(await exists(oldDir)).toBe(false);
		const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], outcome.to.dataDir);
		expect(stdout.trim()).toBe('tickets');
	});

	test('rename updates the display name and the store marker', async () => {
		const repo = await makeRepo('delta');
		const entry = await initProject({
			cwd: repo,
			name: 'delta',
			into: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot,
		});
		await renameProject('delta', 'delta-renamed', configPath);
		expect((await readMarker(entry.location?.dataDir ?? ''))?.name).toBe('delta-renamed');
		const config = await readDaemonConfig(configPath);
		expect(config.projects.find((project) => project.id === entry.id)?.name).toBe('delta-renamed');
	});

	test('adopt re-registers an on-disk store from its marker', async () => {
		const repo = await makeRepo('epsilon');
		const entry = await initProject({
			cwd: repo,
			name: 'epsilon',
			into: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot,
		});
		const dataDir = entry.location?.dataDir ?? '';

		// Drop it from config, leaving the store (and its marker) on disk.
		const config = await readDaemonConfig(configPath);
		await writeDaemonConfig(
			{ ...config, projects: config.projects.filter((project) => project.id !== entry.id) },
			configPath,
		);

		const adopted = await adoptStore(dataDir, { configPath });
		expect(adopted.id).toBe(entry.id);
		expect(adopted.name).toBe('epsilon');
		expect(adopted.location?.scope).toBe('repo');
		const after = await readDaemonConfig(configPath);
		expect(after.projects.some((project) => project.id === entry.id)).toBe(true);
	});

	test('migrate recovers a worktree from origin when the local branch is gone', async () => {
		const remote = join(rootDir, 'remote.git');
		await exec('git', ['init', '--bare', '-b', 'main', remote], rootDir);
		const repo = await makeRepo('zeta');
		await exec('git', ['remote', 'add', 'origin', remote], repo);
		const worktreesA = join(rootDir, 'wtA');
		const entry = await initProject({
			cwd: repo,
			name: 'zeta',
			into: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot: worktreesA,
		});
		const oldDir = entry.location?.dataDir ?? '';

		// Push the data, then destroy both the worktree and the local branch — only origin/tickets survives.
		await exec('git', ['push', 'origin', 'tickets'], oldDir);
		await exec('git', ['worktree', 'remove', '--force', oldDir], repo);
		await exec('git', ['branch', '-D', 'tickets'], repo);
		expect(await exists(oldDir)).toBe(false);

		const worktreesB = join(rootDir, 'wtB');
		const outcome = await migrateProject({
			selector: 'zeta',
			to: 'repo-git',
			configPath,
			storeRoot,
			worktreesRoot: worktreesB,
		});
		expect(outcome.to.dataDir.startsWith(worktreesB)).toBe(true);
		await access(join(outcome.to.dataDir, '.git'));
		const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], outcome.to.dataDir);
		expect(stdout.trim()).toBe('tickets');
	});
});
