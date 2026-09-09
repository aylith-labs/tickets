---
name: Tickets
tagline: 'File a ticket, hand it to your coding agent'
description: >-
  A pluggable personal issue tracker that turns "I should fix that" moments into
  agent work. File a ticket in the browser or a terminal TUI, then copy a
  composed prompt or open a terminal already running your coding agent on it —
  with AI enrichment, git-backed history, and before/after media.
category: developer-tools
status: beta
onboarding:
  access: public-source
  url: https://github.com/aylith-labs/tickets#quick-start
  prerequisites:
    - Git 2.42 or later and a local repository for the default orphan-worktree quick start
    - A standalone release binary for Linux or macOS x64/arm64, or Windows x64
    - The alternative npm CLI route requires Bun 1.2 or later
  limitations:
    - Published binaries are version 0.1.3; current source includes later changes
    - Use release binaries for the browser UI; the published npm 0.1.3 archives omit its app assets
    - Windows x64 release 0.1.3 folder storage passed browser create/edit/reload/restart; Git-backed setup and other platforms remain unverified
    - Released narrow create form overflows at 390px; folder init can initially warn that its storage folder is absent
    - Fresh local 0.1.4 packages repair browser assets and narrow/retryable capture; folder updates and four records survive restart, but these source repairs are not published
    - Agent launch needs a configured terminal, shell and coding agent; defaults can depend on WSL
    - AI enrichment and media publishing require separate provider or publishing access
    - The daemon is local and has no user authentication; do not expose it to an untrusted network
features:
  - 'File tickets in a browser, a terminal TUI, or embedded in any app'
  - 'Hand a ticket to a configured local terminal and coding agent'
  - 'Optional AI enrichment through a configured CLI or provider, with git-backed undo'
  - 'Attach before/after media through your configured media repository and publisher'
  - >-
    Per-project storage on an orphan git branch — nothing pollutes your main
    branch
  - 'Local-first: an auth-less daemon any tool can drive over REST + SSE'
targetUser: >-
  Developers who juggle many repos and want to capture a fix or feature the
  moment they think of it and hand it straight to a coding agent — without
  opening a terminal first.
featured: true
order: 8
icon: >-
  M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375
  5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0
  .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504
  1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z
gradientFrom: '#c97a3a'
gradientTo: '#e0a86b'
---

## Vision

### Try the beta

Start with the [standalone binary release](https://github.com/aylith-labs/tickets/releases/tag/v0.1.3), then follow the [local quick start](https://github.com/aylith-labs/tickets#quick-start). Linux/macOS have a shell installer; Windows x64 users should choose the `.exe` assets. Review the installer before running it. Source and release versions differ; this catalog does not promise newer source changes in older binaries. Artifact availability has been checked; a clean installation of every platform has not.

The friction between "I should fix that" and actually starting is a terminal you
haven't opened yet. Tickets removes it: capture the thought in a browser tab or a
terminal that's already open, then hand it to a coding agent in one action — the
agent starts in the right repo, on the right task, with a prompt you didn't have
to write.

## The problem

Personal issue trackers are either heavyweight SaaS you won't open for a two-line
fix, or a `TODO.md` that never turns into action. Neither knows how to start work.
And the tools built for AI agents run the agent inside themselves — headless, in a
worktree — instead of handing off to the terminal and editor you actually use.

## How it's different

- **Real terminal handoff.** A ticket's action opens *your* terminal (Windows
  Terminal, Tabby, …) running your agent on the ticket — not a headless runner.
- **History is git.** Every edit is a commit on a per-project orphan branch, so
  enrich-with-AI has a real undo and your main branch stays clean.
- **Three surfaces, one daemon.** A browser UI (all projects at once, or one),
  a terminal TUI across every project, and framework-agnostic web components you
  can embed in any app — all over one local, auth-less REST + SSE API.
- **Evidence attachments.** Before/after images and video can use your configured
  media repository and publisher; hosted media access is not supplied by installation.

Local-first and open source. Your tickets live in your own repos; the daemon runs
on your machine and drives your tools.
