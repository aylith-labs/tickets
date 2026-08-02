# tickets

Pluggable personal issue tracker that hands tickets off to coding agents.
File a ticket in the browser, then from its kebab menu: copy a composed agent
prompt, open a terminal (Windows Terminal, Tabby, …) already running
`claude` on the ticket, or AI-enrich the ticket with full undo history.

## Packages

| Package | What |
|---|---|
| [`@aylith/tickets`](https://www.npmjs.com/package/@aylith/tickets) | **Everything in one** — both CLIs (`tickets`, `tickets-tui`) plus the libraries below re-exported as subpaths (`.` = core, `/client`, `/ui`, `/server`) |
| [`@aylith/tickets-core`](https://www.npmjs.com/package/@aylith/tickets-core) | Types, markdown ticket format, storage adapters (git data branch / plain folder), prompt composer |
| [`@aylith/tickets-server`](https://www.npmjs.com/package/@aylith/tickets-server) | `tickets` CLI (`init`, `serve`, `tui`, `list`, `migrate`, `converge`, `rename`, `adopt`) — Hono daemon: REST API, SSE, terminal launch, AI enrich, media pipeline |
| [`@aylith/tickets-ui`](https://www.npmjs.com/package/@aylith/tickets-ui) | Framework-agnostic Lit web components (`<ay-ticket-list>`, `<ay-ticket-card>`, …), themeable via CSS custom properties |
| [`@aylith/tickets-tui`](https://www.npmjs.com/package/@aylith/tickets-tui) | Terminal UI (`tickets-tui` / `tickets tui`) — browse and act on tickets across all projects, Ink + React |
| `apps/web` | Central UI served by the daemon — all projects at `/`, per-project at `/<project>` |

```bash
npm i @aylith/tickets      # everything — then import '@aylith/tickets/ui', '/client', '/server'
npm i @aylith/tickets-ui   # lean: just the web components (no ink/react/hono)
```

## Development & publishing

Each package builds to `dist/` via tsup (JS) + `tsc --emitDeclarationOnly`
(types). In-repo, the daemon/tests/web-build resolve packages from `src`
through the `bun` export condition, so no build step is needed to run locally.

```bash
bun run build       # build all packages to dist/
bun run publish:all # build + bun publish each package (needs npm auth)
```

CI (`.github/workflows/`): `ci.yml` runs tests/typecheck/lint/build on every
push and PR; `publish.yml` publishes the packages to npm on a published
GitHub release (auth via the `NPM_TOKEN` repo secret).

## How data is stored

Tickets are markdown files (`tickets/<id>.md`, YAML frontmatter + body). The
default setup keeps them on a dedicated orphan `tickets` branch of the project's
own repo, checked out as a worktree under `~/.config/aylith-tickets/worktrees/`.
Every mutation is one commit — title/description history and undo come from git,
not a bespoke store.

Each project points at its store through a `StoreLocation`, and the setups
coexist: `repo-git` (the default above), `repo-folder` (`<repo>/.tickets`),
`central-git` (one shared repo) and `central-folder`, both under
`~/.config/aylith-tickets/store/`. Pick one at `tickets init --into <setup>`;
`migrate` and `converge` move a project between them, and `rename` never moves
data. Every store is self-describing — a committed `.tickets-store.json` marker
carries a stable id — so renames, moves and reclones never orphan the data.

## Install

**Standalone binaries** (no runtime needed) — `tickets` (daemon + CLI) and `tickets-tui`:

```bash
curl -fsSL https://raw.githubusercontent.com/aylith-labs/tickets/main/install.sh | bash
```

**mise:**

```bash
mise use -g "ubi:aylith-labs/tickets[exe=tickets]"   # release binary
mise use -g npm:@aylith/tickets                      # npm (needs Bun)
```

**npm** (needs Bun to run — the daemon uses Bun APIs):

```bash
npm i -g @aylith/tickets   # both CLIs: tickets + tickets-tui
```

**From source:**

```bash
git clone https://github.com/aylith-labs/tickets && cd tickets && bun install
bun run build:bin     # → dist-bin/tickets, dist-bin/tickets-tui
```

## Quick start

```bash
cd ~/projects/some-repo
tickets init          # creates the orphan branch + worktree, registers the project
tickets serve         # starts the daemon (all registered projects) + web UI
tickets tui           # browse and act on tickets across all projects
```

## Agent handoff

Every ticket exposes `GET /api/tickets/<project>/<id>/prompt` (plain text). The
terminal launch spawns your configured terminal running
`claude "$(curl -fsS $PROMPT_URL)"` in the project repo, flips the ticket to
`in_progress`, and the prompt instructs the agent to upload before/after media
and PATCH the ticket status when done.
