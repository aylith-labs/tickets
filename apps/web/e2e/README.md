# Isolated Tickets shell acceptance harness

Run from the Tickets repository root in PowerShell. The sibling shell checkout
must already contain its contract package and built `apps/remote/dist`; this
harness never rebuilds or writes the remote. Use an installed Playwright Chromium.

```powershell
$env:PATH='C:/Users/steve/Documents/Codex/2026-09-07/realtime-voice-chat/work/dashcam-runtime/bun-windows-x64;C:/Users/steve/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin;'+$env:PATH
bun install --ignore-scripts --frozen-lockfile
bun run build:web
bun run typecheck
bun test apps/web/src/project-route.test.ts
bun apps/web/node_modules/@playwright/test/cli.js test --config apps/web/e2e/playwright.config.ts
bun ../aylith-shell/node_modules/@playwright/test/cli.js test --config apps/web/e2e/identity.config.ts
```

The identity configuration runs the existing, unchanged `scripts/identity.browser.ts`
with its original Playwright module under Bun (Node rejects its directory import).
Both suites start and stop only dedicated loopback ports 5184 and 5185, sequentially.

`serve-shell.ts` instantiates the real Tickets server and FolderAdapter against a
new OS-temp `aylith-tickets-shell-*` directory per server invocation. It never loads
the ordinary daemon configuration. Launch, enrichment and publishing hooks throw;
there are no status hooks. The synthetic project has an explicit fixture-only ID.
Temp stores are retained for inspection; the UI screenshot includes their path.
The persistence test reads the created Markdown ticket from that temp folder and
checks an additional real REST write reaches the mounted list through SSE.

The shipped HTML leaves optional shell loading disabled. The harness changes only
served HTML responses to opt in to the fixed trusted manifest at
`http://127.0.0.1:5185/mf-manifest.json`. It rewrites the existing dist's baked
localhost:5180 asset prefix in memory to its own preview port. Source and remote
artifacts remain untouched. Query parameters cannot enable or select a remote.
The browser suite blocks requests outside the two fixture origins.

Shell coverage includes stable/legacy/malformed/unknown routes, disk persistence,
SSE, absent shared identity, unavailable preference persistence, manifest/execution
failure, the eight-second mount deadline, stale callbacks and late handles,
real initial/post-mount render failures, draft preservation, retry/native toggles,
theme restoration, 820px layout, 390px navigation/focus, and opt-out/untrusted config.

Reports: `report/index.html` and `report-identity/index.html`. Screenshots and WebM
recordings: `artifacts/` and `artifacts-identity/`. All evidence is gitignored here.

Residual gates: this is a local optional adoption slice, not a deployment or shared
account integration. Host context supplies no user, shared project or credentials;
shared preference load/save explicitly report unavailable. The existing remote
still displays its own generic "Aylith user" / "Aylith workspace" defaults when
identity is absent; host status and fixture disclosure explain the lack of linkage.
Changing those defaults belongs to the shell owner. No live identity, SSO, remote
preference API, production configuration or other browser engine is verified here.
