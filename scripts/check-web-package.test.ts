import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWebPackage } from './check-web-package';

test('package gate refuses missing/empty/directory assets and accepts complete files', async () => {
	// Small isolated fixture retained; never rename/remove the real built assets.
	const root = await mkdtemp(join(tmpdir(), 'tickets-web-package-gate-'));
	await expect(checkWebPackage(root)).rejects.toThrow('index.html');
	await writeFile(join(root, 'index.html'), '<title>test</title>');
	await writeFile(join(root, 'main.js'), '');
	await expect(checkWebPackage(root)).rejects.toThrow('main.js');
	await writeFile(join(root, 'main.js'), 'export {};');
	await expect(checkWebPackage(root)).rejects.toThrow('components.js');
	await writeFile(join(root, 'components.js'), 'export {};');
	await expect(checkWebPackage(root)).resolves.toBeUndefined();
	const directoryCase = await mkdtemp(join(tmpdir(), 'tickets-web-package-directory-'));
	await mkdir(join(directoryCase, 'index.html'));
	await expect(checkWebPackage(directoryCase)).rejects.toThrow('index.html');
});
