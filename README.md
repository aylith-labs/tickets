# tickets

Pluggable personal issue tracker that hands tickets off to coding agents.
File a ticket in the browser, then from its kebab menu: copy a composed agent
prompt, open a terminal (Windows Terminal, Tabby, …) already running
`claude` on the ticket, or AI-enrich the ticket with full undo history.

## Packages

| Package | What |
|---|---|
| `@aylith/tickets-core` | Types, markdown ticket format, storage adapters (git data branch / plain folder), prompt composer |
| `@aylith/tickets-server` | `tickets` CLI (`init`, `serve`) — Hono daemon: REST API, SSE, terminal launch, AI enrich, media pipeline |
| `@aylith/tickets-ui` | Framework-agnostic Lit web components (`<ay-ticket-list>`, `<ay-ticket-card>`, …), themeable via CSS custom properties |
| `apps/web` | Central UI served by the daemon — all projects at `/`, per-project at `/<project>` |

## How data is stored

Default adapter keeps tickets as markdown files (`tickets/<id>.md`, YAML
frontmatter + body) on a dedicated orphan `tickets` branch of the project's own
repo, checked out as a worktree at `<repo>.worktrees/tickets`. Every mutation is
one commit — title/description history and undo come from git, not a bespoke
store. A plain-folder adapter (no git) is available per project.

## Quick start

```bash
cd ~/projects/some-repo
tickets init          # creates the orphan branch + worktree, registers the project
tickets serve         # starts the daemon (all registered projects)
```

## Agent handoff

Every ticket exposes `GET /api/tickets/<project>/<id>/prompt` (plain text). The
terminal launch spawns your configured terminal running
`claude "$(curl -fsS $PROMPT_URL)"` in the project repo, flips the ticket to
`in_progress`, and the prompt instructs the agent to upload before/after media
and PATCH the ticket status when done.
