import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { exec } from '@aylith/tickets-core';
import { readDaemonConfig, writeDaemonConfig } from './registry';
import type { AdapterKind } from './types/AdapterKind';
import type { ProjectEntry } from './types/ProjectEntry';

export const DATA_BRANCH = 'tickets';

export type InitOptions = {
	/** Any directory inside the target repo. */
	cwd: string;
	name?: string;
	adapter?: AdapterKind;
	configPath?: string;
};

const branchExists = async (repoPath: string, branch: string): Promise<boolean> => {
	try {
		await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath);
		return true;
	} catch {
		return false;
	}
};

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

/**
 * Registers the repo containing `cwd`: for the git adapter, creates the orphan
 * `tickets` branch (if missing) checked out as a worktree at
 * `<repo>.worktrees/tickets`, then records the project in the daemon config.
 */
export const initProject = async (options: InitOptions): Promise<ProjectEntry> => {
	const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], options.cwd);
	const repoPath = stdout.trim();
	const name = options.name ?? basename(repoPath);
	const adapter: AdapterKind = options.adapter ?? 'git';
	const dataDir =
		adapter === 'git'
			? join(dirname(repoPath), `${basename(repoPath)}.worktrees`, DATA_BRANCH)
			: join(repoPath, '.tickets');

	if (adapter === 'git' && !(await pathExists(join(dataDir, '.git')))) {
		if (await branchExists(repoPath, DATA_BRANCH)) {
			await exec('git', ['worktree', 'add', dataDir, DATA_BRANCH], repoPath);
		} else {
			// git >= 2.42
			await exec('git', ['worktree', 'add', '--orphan', '-b', DATA_BRANCH, dataDir], repoPath);
			await exec('git', ['commit', '--allow-empty', '--no-verify', '-m', 'Initialize tickets data branch'], dataDir);
		}
	}

	const config = await readDaemonConfig(options.configPath);
	const entry: ProjectEntry = { name, repoPath, adapter, dataDir };
	const existingIndex = config.projects.findIndex((project) => project.name === name);
	if (existingIndex >= 0) config.projects[existingIndex] = entry;
	else config.projects.push(entry);
	await writeDaemonConfig(config, options.configPath);
	return entry;
};
