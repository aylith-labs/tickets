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
  (frontmatter + body), storage adapters (`GitBranchAdapter`, `FolderAdapter`), the
  `StoreLocation` descriptor, `migrateTickets`, prompt composer, and the isomorphic
  `TicketsClient` (exposed at the `./client` subpath so browser bundles never pull the
  Node-only adapters).
- `packages/server` (`@aylith/tickets-server`) — Hono daemon + `tickets` CLI
  (`init`/`serve`/`tui`/`list`/`migrate`/`converge`/`rename`/`adopt`). REST + SSE, terminal
  launch, AI enrich (claude-cli / Anthropic / OpenAI-compatible), media pipeline.
  `cli.ts` (npm, on-disk web) and `binary.ts` (`bun --compile`, embeds `apps/web/dist`)
  both call the shared `runCli`.
- `packages/ui` (`@aylith/tickets-ui`) — Lit web components, themed via `--ay-*` CSS
  custom properties.
- `packages/tui` (`@aylith/tickets-tui`) — Ink terminal UI across all projects.
- `apps/web` — the central UI served by the daemon.

### Storage topology (`StoreLocation`)

- A project's tickets live wherever its `StoreLocation` points, and the daemon
  aggregates across all of them. Setups coexist: **per-repo** (`repo-git` = orphan
  `tickets` branch worktree under `~/.config/aylith-tickets/worktrees/`; `repo-folder`
  = `<repo>/.tickets`) and **central** (`central-git` = one shared repo, or
  `central-folder`, under `~/.config/aylith-tickets/store/`). `tickets init --into <setup>`
  picks one; `migrate`/`converge` move between them; `rename` never moves data.
- Config lives at `~/.config/aylith-tickets/config.json`. Each store is
  **self-describing**: a committed `.tickets-store.json` marker carries a stable,
  immutable project `id`. `name`/`repoPath` are mutable metadata; adapters and routes
  key by `id ?? name`, so renames/moves never orphan or duplicate data.
  `reconcileProjects` heals the config against disk on daemon startup (mints ids for
  legacy entries, re-finds moved stores by id, repairs worktrees, surfaces missing
  stores). Central-git shares one repo across projects — `GitBranchAdapter` serializes
  index-mutating git work per repo root.

## Conventions

- In-repo, packages resolve from `src` via the `bun` export condition + tsconfig
  `paths`; npm consumers get `dist`. Don't rely on `dist` existing for dev/tests.
- Declarations are emitted with `tsc --emitDeclarationOnly` (tsup's rollup-plugin-dts
  is incompatible with TypeScript 7); per-package build tsconfigs clear `paths` so
  they don't emit cross-package `.d.ts`.
- `binary.ts` is excluded from `tsc` (Bun-only `with { type: 'file' }` imports); it's
  validated by `bun --compile` in CI/release only.
- No inline `biome-ignore`; fix the code or adjust `biome.json`.
- Every workflow job uses `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}` per the handbook.
  This repo is public, so it resolves to the GitHub-hosted runner — public repos must never
  reach the org's self-hosted runner.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
