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
features:
  - 'File tickets in a browser, a terminal TUI, or embedded in any app'
  - 'One action opens a terminal running claude on the ticket, in the right repo'
  - 'AI-enrich titles and descriptions — with undo, because history is just git'
  - 'Before/after media on every ticket, hosted on media.aylith.com'
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
- **Evidence built in.** Before/after images and video attach to each ticket and
  publish to media.aylith.com, so the fix is documented, not just done.

Local-first and open source. Your tickets live in your own repos; the daemon runs
on your machine and drives your tools.
