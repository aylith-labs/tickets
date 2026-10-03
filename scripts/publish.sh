#!/usr/bin/env bash
# Build and publish the public @aylith/tickets-* packages to npm.
# Auth: relies on an authenticated ~/.npmrc (run `npm login`) or NPM_TOKEN in the
# environment (CI writes it to ~/.npmrc). `bun publish` converts workspace:* to
# the real version and honours publishConfig.access.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# HEAD is only truthful provenance for a clean source tree. CI writes an auth
# .npmrc in the checkout; it is not source and is the sole allowed untracked file.
dirty="$(git status --porcelain --untracked-files=all | sed '/^?? \.npmrc$/d')"
if [ -n "$dirty" ]; then
	echo "Refusing to publish from a dirty source tree" >&2
	exit 1
fi

bun install --frozen-lockfile

# `bun pm pack` resolves workspace:* pins from bun.lock — a stale lock would
# encode wrong dependency versions in the exact archives we later publish.
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
proof="$(mktemp -d "${TMPDIR:-/tmp}/tickets-publish.XXXXXX")"
TICKETS_PACK_PROOF_DIR="$proof" bash scripts/verify-packed-release.sh
node scripts/plan-packed-publish.mjs "$proof/manifest.json" > "$proof/publish-plan.tsv"

# Dependency order: core first, the umbrella (tickets) last — each package's
# deps must already exist at the version it references.
bash scripts/publish-verified-archives.sh "$proof/publish-plan.tsv"

echo "Done."
