.PHONY: serve serve-bg stop build test check

build: ## Build the web UI + embeddable components bundle
	bun run build:web

serve: build ## Run the daemon in the foreground
	bun packages/server/src/cli.ts serve

serve-bg: build ## Start the daemon in the background (logs to daemon.log)
	@if [ -f daemon.pid ] && kill -0 $$(cat daemon.pid) 2>/dev/null; then \
		echo "tickets daemon already running (pid $$(cat daemon.pid))"; \
	else \
		nohup bun packages/server/src/cli.ts serve > daemon.log 2>&1 & echo $$! > daemon.pid; \
		echo "tickets daemon started (pid $$(cat daemon.pid), tail daemon.log)"; \
	fi

stop: ## Stop the background daemon
	@if [ -f daemon.pid ] && kill $$(cat daemon.pid) 2>/dev/null; then \
		rm -f daemon.pid; echo "tickets daemon stopped"; \
	else \
		rm -f daemon.pid; echo "tickets daemon was not running"; \
	fi

test:
	bun test

check: test ## Full gate: tests, types, lint
	bunx tsc --noEmit
	bunx biome check .
