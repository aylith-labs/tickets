/** Make the exact, digest-checked archive publish plan. Does not publish. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const path = process.argv[2];
assert(path, 'Usage: node scripts/plan-packed-publish.mjs <manifest.json>');
const manifest = JSON.parse(await readFile(path, 'utf8'));
assert.equal(manifest.sourceClean, true, 'Release source changed before packing');
assert.match(manifest.sourceHead, /^[0-9a-f]{40}$/, 'Release source HEAD is missing or invalid');
const names = ['core', 'ui', 'server', 'tui', 'tickets'].map(
	(name) => `@aylith/tickets${name === 'tickets' ? '' : `-${name}`}`,
);
assert.deepEqual(
	manifest.packages.map((pkg) => pkg.name),
	names,
	'Packed package order is incomplete or changed',
);
const rows = [];
for (const pkg of manifest.packages) {
	const expectedPath = join(
		dirname(path),
		'archives',
		`${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`,
	);
	assert.equal(pkg.archive, expectedPath, `Unexpected archive path for ${pkg.name}`);
	const digest = createHash('sha256')
		.update(await readFile(pkg.archive))
		.digest('hex');
	assert.equal(digest, pkg.sha256, `Archive changed after validation: ${pkg.name}`);
	rows.push(`${pkg.name}\t${pkg.archive}\t${pkg.sha256}`);
}
console.log(rows.join('\n'));
