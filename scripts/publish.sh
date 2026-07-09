#!/usr/bin/env bash
# Build and publish the public @aylith/tickets-* packages to npm.
# Auth: relies on an authenticated ~/.npmrc (run `npm login`) or NPM_TOKEN in the
# environment (CI writes it to ~/.npmrc). `bun publish` converts workspace:* to
# the real version and honours publishConfig.access.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bun install --frozen-lockfile

# bun publish resolves workspace:* pins from bun.lock — a stale lock publishes
# wrong dependency versions. Fail fast if the lock disagrees with a package.json.
node -e '
const fs = require("fs");
const lock = JSON.parse(fs.readFileSync("bun.lock", "utf8").replace(/,(\s*[}\]])/g, "$1"));
let stale = false;
for (const [key, entry] of Object.entries(lock.workspaces ?? {})) {
	if (!key) continue;
	const pkg = JSON.parse(fs.readFileSync(`${key}/package.json`, "utf8"));
	if (pkg.version && entry.version !== pkg.version) {
		console.error(`bun.lock is stale: ${key} has ${entry.version} in the lock but ${pkg.version} in package.json — run bun install (delete bun.lock first if it does not refresh)`);
		stale = true;
	}
}
process.exit(stale ? 1 : 0);
'

bun run build

# Dependency order: core first, the umbrella (tickets) last — each package's
# deps must already exist at the version it references.
for pkg in core ui server tui tickets; do
	version=$(cd "packages/$pkg" && node -p "require('./package.json').version")
	name=$(cd "packages/$pkg" && node -p "require('./package.json').name")
	echo "==> publishing $name@$version"
	(cd "packages/$pkg" && bun publish --access public)
done

echo "Done."
