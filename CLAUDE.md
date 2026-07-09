# tickets

<!-- aylith-handbook:start -->
> **📖 Aylith handbook (authoritative).** This repo is part of the `aylith-labs` lab. Before any
> cross-repo, catalog, design-system, CI/runner, or data-flow work you **must** consult the org
> handbook — the single source of truth for these conventions:
> https://github.com/aylith-labs/aylith-handbook (locally `../aylith-handbook/`, skill `aylith-labs`).
<!-- aylith-handbook:end -->

## Project Overview

Pluggable personal issue tracker that hands tickets off to coding agents. A local
**daemon** exposes an auth-less REST + SSE API; three thin surfaces drive it — a
browser UI (all projects, or one), a terminal **TUI**, and framework-agnostic Lit
**web components** other apps embed. A ticket can copy a composed agent prompt,
open a real terminal running `claude` on it, AI-enrich its title/description (with
git-backed undo), and carry before/after media published to media.aylith.com.

Bun + TypeScript monorepo, published under `@aylith/tickets-*` and as standalone
`bun --compile` binaries.

## Commands

```bash
bun install
bun test            # bun test (core + server + tui)
bunx tsc --noEmit   # typecheck (whole monorepo)
bunx biome check .  # lint/format
bun run build       # tsup dual dist for all packages (npm publish artifacts)
bun run build:web   # bundle apps/web → apps/web/dist (+ components.js)
bun run build:bin   # compile dist-bin/tickets + dist-bin/tickets-tui
make serve-bg       # run the daemon in the background (tickets.lvh.me)
```

## Architecture

- `packages/core` (`@aylith/tickets-core`) — ticket types, markdown ticket format
  (frontmatter + body), storage adapters (`GitBranchAdapter` = orphan `tickets`
  branch worktree, `FolderAdapter` = plain folder), prompt composer, and the
  isomorphic `TicketsClient` (exposed at the `./client` subpath so browser bundles
  never pull the Node-only adapters).
- `packages/server` (`@aylith/tickets-server`) — Hono daemon + `tickets` CLI
  (`init`/`serve`/`tui`/`list`). REST + SSE, terminal launch, AI enrich (claude-cli
  / Anthropic / OpenAI-compatible), media pipeline. `cli.ts` (npm, on-disk web) and
  `binary.ts` (`bun --compile`, embeds `apps/web/dist`) both call the shared `runCli`.
- `packages/ui` (`@aylith/tickets-ui`) — Lit web components, themed via `--ay-*` CSS
  custom properties.
- `packages/tui` (`@aylith/tickets-tui`) — Ink terminal UI across all projects.
- `apps/web` — the central UI served by the daemon.
- Ticket **data** lives on each consuming repo's orphan `tickets` branch, never here.

## Conventions

- In-repo, packages resolve from `src` via the `bun` export condition + tsconfig
  `paths`; npm consumers get `dist`. Don't rely on `dist` existing for dev/tests.
- Declarations are emitted with `tsc --emitDeclarationOnly` (tsup's rollup-plugin-dts
  is incompatible with TypeScript 7); per-package build tsconfigs clear `paths` so
  they don't emit cross-package `.d.ts`.
- `binary.ts` is excluded from `tsc` (Bun-only `with { type: 'file' }` imports); it's
  validated by `bun --compile` in CI/release only.
- No inline `biome-ignore`; fix the code or adjust `biome.json`.
- CI runner is `ubuntu-latest` (public repo, per the handbook).
