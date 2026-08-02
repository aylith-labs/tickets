import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT, readDaemonConfig, writeDaemonConfig } from '../registry';

let sandbox: string;

beforeEach(async () => {
	sandbox = await mkdtemp(join(tmpdir(), 'tickets-registry-'));
});

afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

describe('readDaemonConfig', () => {
	test('a missing config is the first-run case', async () => {
		const config = await readDaemonConfig(join(sandbox, 'absent.json'));
		expect(config.port).toBe(DEFAULT_PORT);
		expect(config.projects).toEqual([]);
	});

	test('a malformed config raises instead of presenting an empty project list', async () => {
		const configPath = join(sandbox, 'config.json');
		await writeFile(configPath, '{ "projects": [');
		expect(readDaemonConfig(configPath)).rejects.toThrow('not valid JSON');
	});

	test('round-trips through writeDaemonConfig', async () => {
		const configPath = join(sandbox, 'config.json');
		const written = await readDaemonConfig(join(sandbox, 'absent.json'));
		written.port = 7000;
		await writeDaemonConfig(written, configPath);
		expect((await readDaemonConfig(configPath)).port).toBe(7000);
	});

	test('concurrent writes both land intact', async () => {
		const first = join(sandbox, 'first.json');
		const second = join(sandbox, 'second.json');
		const base = await readDaemonConfig(join(sandbox, 'absent.json'));
		await Promise.all([
			writeDaemonConfig({ ...base, port: 7001 }, first),
			writeDaemonConfig({ ...base, port: 7002 }, second),
		]);
		expect((await readDaemonConfig(first)).port).toBe(7001);
		expect((await readDaemonConfig(second)).port).toBe(7002);
	});
});
