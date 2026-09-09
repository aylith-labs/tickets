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

For the browser app, use the [standalone v0.1.3 release](https://github.com/aylith-labs/tickets/releases/tag/v0.1.3).
Windows x64 users can download `tickets-windows-x64.exe` and run it directly or
rename it to `tickets.exe` on their own PATH. The shell installer below is for
Linux/macOS. No separate Bun install is needed for the standalone binary.

The default Git-backed init needs **Git 2.42 or later**: it uses
[`git worktree add --orphan`, introduced in 2.42](https://raw.githubusercontent.com/git/git/v2.42.0/Documentation/RelNotes/2.42.0.txt).
Git 2.35.1 rejects that command. The folder alternative below avoids that feature,
but does not provide Git-backed revision history or synchronization.

The npm0.1.3 archives contain libraries/CLIs but omit the browser application
assets. They are not a complete `tickets serve` browser install. This source
checkout includes later features; they are not automatically in release0.1.3.

Current local0.1.4 builds include `dist/web` inside the server package and check
those assets before packing. A fresh Windows npm consumer has verified browser
creation, narrow/keyboard recovery, external file updates and records surviving
a daemon restart. These repairs have **not** been published. Build with
`bun run build` before packing; `bun run build:web` also refreshes both the
checkout and packaged browser assets without a Unix `cp` dependency.

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

Choose one storage mode in your local repository. The default example needs
Git2.42+ and initializes a separate tickets worktree:

```bash
cd ~/projects/some-repo
tickets init          # creates the orphan branch + worktree, registers the project
tickets serve         # starts the daemon (all registered projects) + web UI
tickets tui           # browse and act on tickets across all projects
```

For the released0.1.3 plain-folder alternative:

```bash
cd path/to/your/repo
tickets init --adapter folder
tickets serve
```

Open the local URL printed by the daemon. Create a ticket, open it, choose
**Edit**, save, then reload to check the result. A clean Windows x64 folder
installation was verified through creation, title/description/status editing and
retrieval after process restart. This does not verify TUI, the Git adapter,
agents, providers or other operating systems. The release's390px create form
overflows, and folder startup can warn about its not-yet-created storage folder;
those release defects remain open. The daemon has no user authentication: keep
it on a trusted local machine, not an untrusted network.

## Scoped local startup (unreleased source)

For an existing registered project, run the normal CLI in the foreground:

```bash
bun packages/server/src/cli.ts serve --local --project-id <exact-project-id> --port 6320
```

Repeat `--project-id <id>` to select more than one project. This mode requires
exact stable IDs, binds only `127.0.0.1`, skips registry reconciliation and shared
store discovery, and disables the selected Git adapters' automatic pushes in
memory. It does not rewrite configuration, mint IDs, repair/move stores or start
agents. Selected stores must already have matching version-1 markers; missing,
ambiguous, unavailable or mismatched selections fail before listening.
Git stores must resolve to the exact configured worktree root (the central
store root for central Git) and match their configured branch when specified.

Ticket edits still write to the selected stores and Git stores still commit
locally. Local mode makes terminal launch, enrichment, media publishing and
status hooks unavailable because they can execute or publish outside the
selected stores. No HTTP route can register/remove projects or change settings;
the running selection stays fixed until restart. This is not a read-only mode
or an authentication change. Plain `serve` retains its all-project
reconciliation and configured actions/push behavior. This option is not yet in
published packages.

Local mode also checks the actual listener host/port and the browser's exact
origin before routing a request. Other local apps, opaque origins and foreign
websites cannot read or mutate that daemon through cross-origin API requests;
forwarded headers do not grant access. Following a link into the top-level UI
still works. Native local clients without browser headers remain supported, so
this is **not** user/tenant authentication or isolation from other local processes.
Named reverse-proxy hosting is not enabled by this flag; do not alias another
app or fixture server to make a hostname appear available.

The UI reports media upload availability separately from existing attachments.
Local mode and unconfigured publication show a neutral explanation; older
servers without capability metadata show unknown availability. No upload picker
is offered until the server explicitly declares support. Existing evidence and
ordinary ticket editing remain available.

## Agent handoff

### Opt-in request observation (unreleased source)

Embedded hosts may pass `requestObservation: createRequestObservation(sink)` to
`createApp`. The synchronous sink accepts a frozen version1 request observation
and returns a boolean queue acknowledgement; it must not perform blocking work.
Only five finite labels are emitted: `tickets-projects` (GET), `tickets-list`
(GET), `tickets-detail` (GET), `tickets-create` (POST), `tickets-update` (PATCH).
Payload fields are event ID, epoch-ms occurrence, label, method, HTTP status and
bounded elapsed milliseconds. No project/ticket identity, URL/query, body, header,
exception or response content is emitted. Remaining encoded path aliases,
unknown routes, SSE, media and agent/triage operations are excluded. Runtime URL
normalization before middleware is not reversible or an access-control boundary.

`snapshot()` reports accepted/dropped counts; `close()` disables current/future
observations without cancelling product requests. Sink exceptions, rejected or
misused async acknowledgements cannot change the product response. The host owns
the separate bounded sender, current ingest grant, exact source/tenant mapping
and shutdown. This does not add identity to the auth-less daemon. Default startup
is unchanged: no automatic network delivery, process, monitoring or owner setup.

Local native browser proof connects this source to the private Hub collector,
including lost-ack deduplication and independent Tickets/Hub restarts. Unexpected
folder-list failures now surface as errors instead of empty successful lists;
the UI offers keyboard Retry, preserves saved drafts and does not present an
unread list as zero tickets. Missing/uninitialized folders remain empty. This is
source verification with task-owned data, not published-package or owner parity.

### Opt-in private incident triage (unreleased source)

`createApp(context, {local: true, incidentTriage: options})` can register the
version1 `GET|POST /api/incident-triage/incidents/<uuid>` capability. It is absent
by default and not automatically activated by `serve --local`. Options require
an exact existing project ID, its actual `FolderAdapter`, matching marked
`dataDir`, one `allowedScope`, exact local `hubOrigin` and a current
`authority(token)` callback. Read/create roles are separate; empty, revoked,
expired, remapped and other-scope requests fail closed. Keep the existing local
host/Origin guard around the handler. This is not authentication for the rest of
the auth-less personal daemon, an owner account mapping or a named-host setup.

POST accepts `{schemaVersion:1,incident:{id,scope,eventId,fingerprint,firstSeen,lastSeen}}`.
It creates one ordinary Markdown ticket with provenance in the same file. A
complete staged file is exclusively hard-linked to a deterministic15-digit ID;
an occupied path must match the full source provenance, never be overwritten.
Retries, concurrent imports, lost acknowledgements and process restart return
the same work item and preserve edits/archive. Unsupported source versions and
collisions are explicit errors. This requires local filesystem hard-link support;
Git adapters are deliberately rejected. Host power loss/directory-journal
durability and changes by a hostile local filesystem writer are not claimed.

The minimal response contains version1, projectId and ticket `{id,title,status,created}`
(or null for an absent read), plus `duplicate` on POST. There is no Hub status
mirroring. The UI's source-incident link is validated against the exact project
and opens the Hub without credentials/referrer; Hub still requires its own read
grant. Unknown provenance survives ordinary editing but is not used as a link.
No external agent, provider, publication or registry repair is performed.

### Existing agent prompt

Every ticket exposes `GET /api/tickets/<project>/<id>/prompt` (plain text). The
terminal launch spawns your configured terminal running
`claude "$(curl -fsS $PROMPT_URL)"` in the project repo, flips the ticket to
`in_progress`, and the prompt instructs the agent to upload before/after media
and PATCH the ticket status when done.
