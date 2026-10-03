/** Verify the bytes produced by `bun pm pack`, before any package is published. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const proof = process.argv[2];
assert(proof, 'Usage: node scripts/verify-packed-release.mjs <extracted-proof-directory>');
const names = ['core', 'ui', 'server', 'tui', 'tickets'];
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const packages = new Map(
	await Promise.all(names.map(async (name) => [name, await json(join(source, 'packages', name, 'package.json'))])),
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nonempty = async (path) => {
	const info = await stat(path);
	assert(info.isFile() && info.size > 0, `Missing or empty packed file: ${path}`);
	return readFile(path);
};

const result = {
	sourceHead: process.env.TICKETS_SOURCE_HEAD ?? null,
	sourceClean: process.env.TICKETS_SOURCE_CLEAN === 'true',
	packages: [],
	webAssets: [],
};
for (const name of names) {
	const pkg = packages.get(name);
	const packed = await json(join(proof, name, 'package', 'package.json'));
	assert.equal(packed.name, pkg.name, `Packed ${name} name differs from source`);
	assert.equal(packed.version, pkg.version, `Packed ${name} version differs from source`);
	const expectedDependencies = Object.fromEntries(
		Object.entries(pkg.dependencies ?? {}).map(([dependency, version]) => {
			if (version !== 'workspace:*') return [dependency, version];
			const sibling = [...packages.values()].find((candidate) => candidate.name === dependency);
			assert(sibling, `Unknown workspace dependency ${dependency}`);
			return [dependency, sibling.version];
		}),
	);
	assert.deepEqual(packed.dependencies ?? {}, expectedDependencies, `Packed ${name} dependencies differ from source`);
	for (const entry of [pkg.main, ...Object.values(pkg.bin ?? {})]) {
		if (entry) await nonempty(join(proof, name, 'package', entry));
	}
	const archive = join(proof, 'archives', `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
	result.packages.push({ name: pkg.name, version: pkg.version, archive, sha256: sha256(await nonempty(archive)) });
}

for (const name of ['index.html', 'main.js', 'components.js']) {
	const packed = await nonempty(join(proof, 'server', 'package', 'dist', 'web', name));
	const built = await nonempty(join(source, 'apps', 'web', 'dist', name));
	assert.equal(sha256(packed), sha256(built), `Packed browser asset ${name} differs from current build`);
	result.webAssets.push({ name, sha256: sha256(packed), bytes: packed.length });
}

console.log(JSON.stringify(result, null, 2));
