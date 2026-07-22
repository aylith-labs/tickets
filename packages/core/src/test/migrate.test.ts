import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderAdapter } from '../adapters/FolderAdapter';
import { exec } from '../exec';
import { migrateTickets } from '../migrate';
import type { StoreLocation } from '../types/StoreLocation';

let rootDir: string;

const folderLocation = (dataDir: string): StoreLocation => ({ kind: 'folder', scope: 'repo', dataDir });

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), 'tickets-migrate-test-'));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe('migrateTickets', () => {
	test('copies ticket state to the destination and leaves the source untouched', async () => {
		const fromDir = join(rootDir, 'from');
		const source = new FolderAdapter({ dataDir: fromDir });
		await source.create({ title: 'One' });
		await source.create({ title: 'Two' });

		const toDir = join(rootDir, 'to');
		const { copied } = await migrateTickets(folderLocation(fromDir), folderLocation(toDir));
		expect(copied.sort()).toEqual(['0001', '0002']);

		const dest = new FolderAdapter({ dataDir: toDir });
		expect((await dest.list()).map((ticket) => ticket.title).sort()).toEqual(['One', 'Two']);
		// source still has its files
		expect((await readdir(join(fromDir, 'tickets'))).sort()).toEqual(['0001.md', '0002.md']);
	});

	test('commits at a git destination', async () => {
		const fromDir = join(rootDir, 'from');
		const source = new FolderAdapter({ dataDir: fromDir });
		await source.create({ title: 'Ship it' });

		const toDir = join(rootDir, 'store', 'proj');
		await mkdir(toDir, { recursive: true });
		await exec('git', ['init', '-b', 'main'], join(rootDir, 'store'));
		await exec('git', ['config', 'user.email', 't@t'], join(rootDir, 'store'));
		await exec('git', ['config', 'user.name', 't'], join(rootDir, 'store'));

		await migrateTickets(folderLocation(fromDir), { kind: 'git', scope: 'central', dataDir: toDir, branch: 'main' });
		const { stdout } = await exec('git', ['log', '--format=%s'], join(rootDir, 'store'));
		expect(stdout).toContain('Migrate tickets (current state)');
	});

	test('converging two same-id sources lands them in distinct subfolders', async () => {
		const storeRoot = join(rootDir, 'store');
		for (const [repo, subdir, title] of [
			['alpha', 'alpha-1', 'Alpha'],
			['beta', 'beta-2', 'Beta'],
		] as const) {
			const fromDir = join(rootDir, repo);
			await new FolderAdapter({ dataDir: fromDir }).create({ title });
			await migrateTickets(folderLocation(fromDir), folderLocation(join(storeRoot, subdir)));
		}
		// Both kept id 0001, but in separate subfolders — no collision.
		await writeFile(join(storeRoot, 'marker'), '', 'utf8');
		expect((await readdir(storeRoot)).sort()).toEqual(['alpha-1', 'beta-2', 'marker']);
		expect((await new FolderAdapter({ dataDir: join(storeRoot, 'alpha-1') }).list())[0]?.title).toBe('Alpha');
		expect((await new FolderAdapter({ dataDir: join(storeRoot, 'beta-2') }).list())[0]?.title).toBe('Beta');
	});
});
