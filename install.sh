#!/usr/bin/env bash
# Install the tickets standalone binaries from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/aylith-labs/tickets/main/install.sh | bash
# Override the install dir with TICKETS_BIN_DIR.
set -euo pipefail

REPO="aylith-labs/tickets"
BIN_DIR="${TICKETS_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
	Linux) os=linux ;;
	Darwin) os=darwin ;;
	*)
		echo "tickets: unsupported OS '$os' — use 'npm i -g @aylith/tickets-server @aylith/tickets-tui' instead" >&2
		exit 1
		;;
esac
case "$arch" in
	x86_64 | amd64) arch=x64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*)
		echo "tickets: unsupported arch '$arch'" >&2
		exit 1
		;;
esac
platform="$os-$arch"

mkdir -p "$BIN_DIR"
for bin in tickets tickets-tui; do
	url="https://github.com/$REPO/releases/latest/download/$bin-$platform"
	echo "tickets: downloading $bin ($platform)…"
	curl -fsSL "$url" -o "$BIN_DIR/$bin"
	chmod +x "$BIN_DIR/$bin"
done

echo "tickets: installed tickets + tickets-tui to $BIN_DIR"
case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*) echo "tickets: add $BIN_DIR to your PATH (e.g. export PATH=\"$BIN_DIR:\$PATH\")" ;;
esac
echo "tickets: run 'tickets init' in a repo, then 'tickets serve' and 'tickets tui'."
