import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One build feeds both the standalone binary and the npm daemon. No shell cp
// dependency and no source paths resolved against the caller's working directory.
const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'apps/web/dist');
const packaged = join(root, 'packages/server/dist/web');
const builds = [
	{ entry: 'apps/web/src/main.ts', name: 'main.js' },
	{ entry: 'packages/ui/src/index.ts', name: 'components.js' },
];
await mkdir(web, { recursive: true });
await mkdir(packaged, { recursive: true });
for (const { entry, name } of builds) {
	const result = await Bun.build({
		entrypoints: [join(root, entry)],
		target: 'browser',
		format: 'esm',
		conditions: ['bun'],
		minify: true,
		splitting: false,
	});
	if (!result.success) throw new AggregateError(result.logs, `Could not build ${entry}`);
	if (result.outputs.length !== 1) throw new Error(`Expected one self-contained output for ${entry}`);
	const output = result.outputs[0];
	if (!output) throw new Error(`Missing output for ${entry}`);
	await Bun.write(join(web, name), output);
	await copyFile(join(web, name), join(packaged, name));
}
await copyFile(join(root, 'apps/web/index.html'), join(web, 'index.html'));
await copyFile(join(web, 'index.html'), join(packaged, 'index.html'));
console.log('Built browser assets for apps/web/dist and packages/server/dist/web');
