#!/usr/bin/env bun
import { initProject } from './init';
import { readDaemonConfig } from './registry';
import { startDaemon } from './serve';
import { runTui } from './tui';
import type { AdapterKind } from './types/AdapterKind';

const HELP = `tickets — pluggable personal issue tracker

Usage:
  tickets init [--name <project>] [--adapter git|folder]   Register the repo you are in
  tickets serve [--port <port>]                            Start the daemon
  tickets tui [--api-base <url>]                           Browse tickets in the terminal
  tickets list                                             Print registered projects
  tickets help
`;

const readFlag = (args: string[], flag: string): string | undefined => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const main = async (): Promise<void> => {
	const [command, ...rest] = process.argv.slice(2);
	switch (command) {
		case 'init': {
			const adapterFlag = readFlag(rest, '--adapter');
			if (adapterFlag && adapterFlag !== 'git' && adapterFlag !== 'folder') {
				console.error(`Unknown adapter "${adapterFlag}" (use git or folder)`);
				process.exit(1);
			}
			const entry = await initProject({
				cwd: process.cwd(),
				name: readFlag(rest, '--name'),
				adapter: adapterFlag as AdapterKind | undefined,
			});
			console.log(
				`Registered project "${entry.name}" (${entry.adapter})\n  repo:  ${entry.repoPath}\n  data:  ${entry.dataDir}`,
			);
			return;
		}
		case 'serve': {
			const portFlag = readFlag(rest, '--port');
			await startDaemon({ port: portFlag ? Number.parseInt(portFlag, 10) : undefined });
			return;
		}
		case 'tui': {
			runTui(rest);
			return;
		}
		case 'list': {
			const config = await readDaemonConfig();
			if (config.projects.length === 0) {
				console.log('No projects registered. Run `tickets init` inside a repo.');
				return;
			}
			for (const project of config.projects) {
				console.log(`${project.name}\t${project.adapter}\t${project.repoPath}`);
			}
			return;
		}
		default:
			console.log(HELP);
			if (command && command !== 'help') process.exit(1);
	}
};

await main();
