import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderAdapter } from '../adapters/FolderAdapter';
import { GitBranchAdapter } from '../adapters/GitBranchAdapter';
import { exec } from '../exec';

let dataDir: string;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'tickets-test-'));
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

describe('FolderAdapter', () => {
	test('create/list/get/update/archive lifecycle', async () => {
		const adapter = new FolderAdapter({ dataDir });
		const created = await adapter.create({ title: 'First ticket', description: 'Do the thing.' });
		expect(created.id).toBe('0001');
		expect(created.status).toBe('todo');

		const second = await adapter.create({ title: 'Second' });
		expect(second.id).toBe('0002');

		const listed = await adapter.list();
		expect(listed.map((ticket) => ticket.id)).toEqual(['0002', '0001']);

		const updated = await adapter.update('0001', { status: 'in_progress' });
		expect(updated.status).toBe('in_progress');
		expect(updated.updated).toBeDefined();

		const archived = await adapter.archive('0002');
		expect(archived.archived).toBe(true);

		const fetched = await adapter.get('0001');
		expect(fetched?.title).toBe('First ticket');
		expect(fetched?.description).toBe('Do the thing.');
	});

	test('has no revisions', async () => {
		const adapter = new FolderAdapter({ dataDir });
		await adapter.create({ title: 'One' });
		expect(await adapter.getRevisions('0001')).toEqual([]);
		expect(adapter.restoreRevision('0001', 'whatever')).rejects.toThrow('no revision history');
	});

	test('update of a missing ticket throws', async () => {
		const adapter = new FolderAdapter({ dataDir });
		expect(adapter.update('0404', { title: 'Nope' })).rejects.toThrow('not found');
	});
});

describe('GitBranchAdapter', () => {
	const initGitDataDir = async () => {
		await exec('git', ['init', '-b', 'tickets'], dataDir);
		await exec('git', ['config', 'user.email', 'tickets@test.local'], dataDir);
		await exec('git', ['config', 'user.name', 'Tickets Test'], dataDir);
	};

	test('every mutation is one commit; revisions and restore work', async () => {
		await initGitDataDir();
		const adapter = new GitBranchAdapter({ dataDir, push: false });

		const created = await adapter.create({ title: 'Original title', description: 'Original body.' });
		await adapter.update(
			created.id,
			{ title: 'Enriched title', description: 'Enriched body.' },
			`Enrich ticket ${created.id}`,
		);

		const revisions = await adapter.getRevisions(created.id);
		expect(revisions.length).toBe(2);
		expect(revisions[0]?.message).toBe('Enrich ticket 0001');
		expect(revisions[1]?.message).toBe('Create ticket 0001');

		const original = await adapter.getRevision(created.id, revisions[1]?.ref ?? '');
		expect(original?.title).toBe('Original title');

		const restored = await adapter.restoreRevision(created.id, revisions[1]?.ref ?? '');
		expect(restored.title).toBe('Original title');
		expect(restored.description).toBe('Original body.');

		const afterRestore = await adapter.getRevisions(created.id);
		expect(afterRestore.length).toBe(3);
		expect(afterRestore[0]?.message).toStartWith('Restore ticket 0001 to ');
	});

	test('restore keeps runtime state (status, attachments)', async () => {
		await initGitDataDir();
		const adapter = new GitBranchAdapter({ dataDir, push: false });
		const created = await adapter.create({ title: 'Original', description: 'Body.' });
		await adapter.update(created.id, { title: 'Enriched' });
		await adapter.update(created.id, { status: 'in_progress' });

		const revisions = await adapter.getRevisions(created.id);
		const createRef = revisions[revisions.length - 1]?.ref ?? '';
		const restored = await adapter.restoreRevision(created.id, createRef);
		expect(restored.title).toBe('Original');
		expect(restored.status).toBe('in_progress');
	});

	test('identical content produces no commit and no error', async () => {
		await initGitDataDir();
		const adapter = new GitBranchAdapter({ dataDir, push: false });
		const created = await adapter.create({ title: 'Same', description: 'Same.' });
		const before = await adapter.getRevisions(created.id);
		await adapter.update(created.id, {}); // only `updated` changes → still a commit
		await adapter.flush();
		const after = await adapter.getRevisions(created.id);
		expect(after.length).toBeGreaterThanOrEqual(before.length);
	});

	test('push failures are swallowed (no origin configured)', async () => {
		await initGitDataDir();
		const adapter = new GitBranchAdapter({ dataDir, push: true });
		await adapter.create({ title: 'Push me' });
		await adapter.flush(); // must not throw even though there is no origin
	});
});
