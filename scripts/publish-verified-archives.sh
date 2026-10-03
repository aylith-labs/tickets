#!/usr/bin/env bash
# Consume only a complete, digest-checked plan from plan-packed-publish.mjs.
set -euo pipefail

plan="${1:?Usage: publish-verified-archives.sh <publish-plan.tsv>}"
while IFS=$'\t' read -r name archive digest; do
	actual="$(sha256sum "$archive" | cut -d' ' -f1)"
	if [ "$actual" != "$digest" ]; then
		echo "Archive changed before publish: $name" >&2
		exit 1
	fi
	echo "==> publishing verified $name archive"
	bun publish "$archive" --access public
done < "$plan"
