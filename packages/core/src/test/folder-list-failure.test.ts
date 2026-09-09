import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderAdapter } from '../adapters/FolderAdapter';

test('missing storage is empty; failed storage rejects and recovered records retain their IDs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tickets-list-failure-'));
	const adapter = new FolderAdapter({ dataDir: root });
	expect(await adapter.list()).toEqual([]);
	const record = await adapter.create({ title: 'Retained native record' });
	const dir = join(root, 'tickets');
	await rename(dir, dir + '.retained');
	await writeFile(dir, 'Task-owned blocked directory.');
	await expect(adapter.list()).rejects.toMatchObject({ code: 'ENOTDIR' });
	await rename(dir, dir + '.blocked');
	await rename(dir + '.retained', dir);
	expect((await adapter.list()).map((t) => t.id)).toEqual([record.id]);
	await mkdir(join(dir, 'unreadable.md'));
	await expect(adapter.list()).rejects.toMatchObject({ code: 'EISDIR' });
});
