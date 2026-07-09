#!/usr/bin/env bash
# Build and publish the public @aylith/tickets-* packages to npm.
# Auth: relies on an authenticated ~/.npmrc (run `npm login`) or NPM_TOKEN in the
# environment (CI writes it to ~/.npmrc). `bun publish` converts workspace:* to
# the real version and honours publishConfig.access.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bun install --frozen-lockfile
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
