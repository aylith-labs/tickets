#!/usr/bin/env bash
# Pack all published packages, extract their actual archive bytes, then verify.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof="${TICKETS_PACK_PROOF_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/tickets-packed-release.XXXXXX")}"
mkdir -p "$proof/archives"

for name in core ui server tui tickets; do
	archive="$(cd "$root/packages/$name" && bun pm pack --ignore-scripts --destination "$proof/archives" --quiet)"
	case "$archive" in "$proof/archives/"*.tgz) ;; *) echo "Unexpected archive path for $name" >&2; exit 1 ;; esac
	mkdir -p "$proof/$name"
	tar -xzf "$archive" -C "$proof/$name"
done

source_status="$(git -C "$root" status --porcelain --untracked-files=all | sed '/^?? \.npmrc$/d')"
source_clean=false
if [ -z "$source_status" ]; then source_clean=true; fi
TICKETS_SOURCE_HEAD="$(git -C "$root" rev-parse HEAD)" TICKETS_SOURCE_CLEAN="$source_clean" \
	node "$root/scripts/verify-packed-release.mjs" "$proof" > "$proof/manifest.json"
cat "$proof/manifest.json"
echo "Packed release proof: $proof"
