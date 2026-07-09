#!/usr/bin/env bun
import { render } from 'ink';
import { resolveApiBase } from './config';
import { TicketsApp } from './TicketsApp';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(`tickets-tui — browse and act on tickets across all projects

Usage: tickets-tui [--api-base <url>]

  --api-base <url>   Daemon API base (default: from ~/.config/aylith-tickets/config.json,
                     or TICKETS_API_BASE, or http://localhost:6320/api)

Keys: enter launch · c copy prompt · e enrich · u undo · s status · a archive · / filter · ? help · q quit`);
	process.exit(0);
}

const apiBaseFlag = args.includes('--api-base') ? args[args.indexOf('--api-base') + 1] : undefined;
const apiBase = resolveApiBase(apiBaseFlag);

const { waitUntilExit } = render(<TicketsApp apiBase={apiBase} />);
await waitUntilExit();
