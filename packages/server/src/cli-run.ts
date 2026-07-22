import { initProject } from './init';
import { convergeProjects, type MigrateOutcome, migrateProject, renameProject } from './migrate';
import { projectLocation, readDaemonConfig } from './registry';
import type { WebAssets } from './serve';
import { startDaemon } from './serve';
import { runTui } from './tui';
import type { AdapterKind } from './types/AdapterKind';
import type { StoreSetup } from './types/StoreSetup';

const SETUPS: StoreSetup[] = ['repo-git', 'repo-folder', 'central-git', 'central-folder'];

const HELP = `tickets — pluggable personal issue tracker

Usage:
  tickets init [--name <project>] [--into <setup>] [--adapter git|folder]
               [--central] [--remote <url>]              Register the repo you are in
  tickets serve [--port <port>]                          Start the daemon
  tickets tui [--api-base <url>]                         Browse tickets in the terminal
  tickets list                                           Print registered projects
  tickets migrate <project> --to <setup> [--remote <url>] [--cleanup]
                                                         Re-home one project to another setup
  tickets converge [--adapter git|folder] [--remote <url>] [--cleanup]
                                                         Move every per-repo project into the central store
  tickets rename <project|id> <new-name>                 Rename a project (data stays put)
  tickets help

Setups (--into / --to): repo-git (default), repo-folder, central-git, central-folder
  repo-*    tickets live with the repo (git worktree under ~/.config/aylith-tickets/worktrees, or <repo>/.tickets)
  central-* tickets live in one shared store at ~/.config/aylith-tickets/store
  --central is shorthand for central-<adapter>; --remote points a central-git store at a shared repo
  --cleanup removes the old store, but only when the data is provably safe (pushed, or a plain folder)
`;

const readFlag = (args: string[], flag: string): string | undefined => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const resolveSetup = (into: string | undefined, central: boolean, adapter: AdapterKind | undefined): StoreSetup => {
	if (into) return into as StoreSetup;
	const kind = adapter ?? 'git';
	if (central) return kind === 'folder' ? 'central-folder' : 'central-git';
	return kind === 'folder' ? 'repo-folder' : 'repo-git';
};

const printOutcome = (outcome: MigrateOutcome): void => {
	if (outcome.unchanged) {
		console.log(`${outcome.name}: already at ${outcome.to.dataDir}`);
		return;
	}
	const verb = outcome.moved ? 'moved worktree' : `copied ${outcome.copied} ticket(s)`;
	console.log(`${outcome.name}: ${verb} → ${outcome.to.kind}/${outcome.to.scope} ${outcome.to.dataDir}`);
	if (outcome.cleanupSkipped) console.log(`  cleanup skipped: ${outcome.cleanupSkipped}`);
	else if (outcome.cleaned) console.log('  old store removed');
};

/** Dispatch a CLI invocation. `webAssets` is set only by the compiled binary (embedded UI). */
export const runCli = async (argv: string[], options: { webAssets?: WebAssets } = {}): Promise<void> => {
	const [command, ...rest] = argv;
	switch (command) {
		case 'init': {
			const adapterFlag = readFlag(rest, '--adapter');
			if (adapterFlag && adapterFlag !== 'git' && adapterFlag !== 'folder') {
				console.error(`Unknown adapter "${adapterFlag}" (use git or folder)`);
				process.exit(1);
			}
			const intoFlag = readFlag(rest, '--into');
			if (intoFlag && !SETUPS.includes(intoFlag as StoreSetup)) {
				console.error(`Unknown setup "${intoFlag}" (use ${SETUPS.join(', ')})`);
				process.exit(1);
			}
			const setup = resolveSetup(intoFlag, rest.includes('--central'), adapterFlag as AdapterKind | undefined);
			const entry = await initProject({
				cwd: process.cwd(),
				name: readFlag(rest, '--name'),
				into: setup,
				remote: readFlag(rest, '--remote'),
			});
			const location = projectLocation(entry);
			console.log(
				`Registered project "${entry.name}" (${location.kind}/${location.scope})\n  repo:  ${entry.repoPath}\n  data:  ${location.dataDir}`,
			);
			return;
		}
		case 'serve': {
			const portFlag = readFlag(rest, '--port');
			await startDaemon({ port: portFlag ? Number.parseInt(portFlag, 10) : undefined, webAssets: options.webAssets });
			return;
		}
		case 'tui': {
			runTui(rest);
			return;
		}
		case 'migrate': {
			const selector = rest[0];
			const toFlag = readFlag(rest, '--to');
			if (!selector || selector.startsWith('--') || !toFlag) {
				console.error('Usage: tickets migrate <project> --to <setup> [--remote <url>] [--cleanup]');
				process.exit(1);
			}
			if (!SETUPS.includes(toFlag as StoreSetup)) {
				console.error(`Unknown setup "${toFlag}" (use ${SETUPS.join(', ')})`);
				process.exit(1);
			}
			printOutcome(
				await migrateProject({
					selector,
					to: toFlag as StoreSetup,
					remote: readFlag(rest, '--remote'),
					cleanup: rest.includes('--cleanup'),
				}),
			);
			return;
		}
		case 'converge': {
			const adapterFlag = readFlag(rest, '--adapter');
			if (adapterFlag && adapterFlag !== 'git' && adapterFlag !== 'folder') {
				console.error(`Unknown adapter "${adapterFlag}" (use git or folder)`);
				process.exit(1);
			}
			const outcomes = await convergeProjects({
				setup: adapterFlag === 'folder' ? 'central-folder' : 'central-git',
				remote: readFlag(rest, '--remote'),
				cleanup: rest.includes('--cleanup'),
			});
			if (outcomes.length === 0) {
				console.log('No per-repo projects to converge.');
				return;
			}
			for (const outcome of outcomes) printOutcome(outcome);
			console.log('Note: current ticket state was copied; prior git history stays in each old store.');
			return;
		}
		case 'rename': {
			const [selector, newName] = rest;
			if (!selector || !newName || newName.startsWith('--')) {
				console.error('Usage: tickets rename <project|id> <new-name>');
				process.exit(1);
			}
			const entry = await renameProject(selector, newName);
			console.log(`Renamed to "${entry.name}"`);
			return;
		}
		case 'list': {
			const config = await readDaemonConfig();
			if (config.projects.length === 0) {
				console.log('No projects registered. Run `tickets init` inside a repo.');
				return;
			}
			for (const project of config.projects) {
				const location = projectLocation(project);
				const unavailable = project.unavailable ? `\t(${project.unavailable})` : '';
				console.log(`${project.name}\t${location.kind}/${location.scope}\t${location.dataDir}${unavailable}`);
			}
			return;
		}
		default:
			console.log(HELP);
			if (command && command !== 'help') process.exit(1);
	}
};
