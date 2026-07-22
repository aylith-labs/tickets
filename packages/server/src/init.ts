import { access, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { exec, type StoreLocation, TICKETS_DIR } from '@aylith/tickets-core';
import { generateProjectId, projectSubdir } from './identity';
import { projectLocation, readDaemonConfig, writeDaemonConfig } from './registry';
import { readMarker, writeAndCommitMarker } from './store-marker';
import type { AdapterKind } from './types/AdapterKind';
import type { ProjectEntry } from './types/ProjectEntry';
import type { StoreSetup } from './types/StoreSetup';

export const DATA_BRANCH = 'tickets';

export type InitOptions = {
	/** Any directory inside the target repo. */
	cwd: string;
	name?: string;
	into?: StoreSetup;
	/** Legacy alias: maps to repo-git / repo-folder. */
	adapter?: AdapterKind;
	/** git central only: clone/point the shared store at this remote. */
	remote?: string;
	/** Overrides for tests; default to the daemon config's roots. */
	storeRoot?: string;
	worktreesRoot?: string;
	configPath?: string;
};

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const branchExists = async (repoPath: string, branch: string): Promise<boolean> => {
	try {
		await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath);
		return true;
	} catch {
		return false;
	}
};

const gitRemote = async (dir: string): Promise<string | undefined> =>
	exec('git', ['remote', 'get-url', 'origin'], dir)
		.then(({ stdout }) => stdout.trim() || undefined)
		.catch(() => undefined);

const gitBranch = async (dir: string): Promise<string> =>
	exec('git', ['symbolic-ref', '--short', 'HEAD'], dir)
		.then(({ stdout }) => stdout.trim() || 'main')
		.catch(() => 'main');

/** Fresh app-created repos (esp. on CI) have no committer identity — set a local fallback. */
const ensureGitIdentity = async (repoDir: string): Promise<void> => {
	const hasEmail = await exec('git', ['config', 'user.email'], repoDir)
		.then(() => true)
		.catch(() => false);
	if (hasEmail) return;
	await exec('git', ['config', 'user.email', 'tickets@localhost'], repoDir);
	await exec('git', ['config', 'user.name', 'aylith-tickets'], repoDir);
};

const ensureCentralRepo = async (storeRoot: string, remote?: string): Promise<void> => {
	if (await pathExists(join(storeRoot, '.git'))) return;
	await mkdir(dirname(storeRoot), { recursive: true });
	if (remote) await exec('git', ['clone', remote, storeRoot], dirname(storeRoot));
	else await exec('git', ['init', '-b', 'main', storeRoot], dirname(storeRoot));
	await ensureGitIdentity(storeRoot);
};

type ProvisionInput = {
	setup: StoreSetup;
	repoPath: string;
	storeRoot: string;
	worktreesRoot: string;
	subdir: string;
	remote?: string;
};

/** Creates the on-disk store for a setup (if missing) and returns its location. */
const provisionStore = async (input: ProvisionInput): Promise<StoreLocation> => {
	const { setup, repoPath, storeRoot, worktreesRoot, subdir, remote } = input;
	if (setup === 'repo-folder') {
		const dataDir = join(repoPath, '.tickets');
		await mkdir(join(dataDir, TICKETS_DIR), { recursive: true });
		return { kind: 'folder', scope: 'repo', dataDir };
	}
	if (setup === 'central-folder') {
		const dataDir = join(storeRoot, subdir);
		await mkdir(join(dataDir, TICKETS_DIR), { recursive: true });
		return { kind: 'folder', scope: 'central', dataDir };
	}
	if (setup === 'central-git') {
		await ensureCentralRepo(storeRoot, remote);
		const dataDir = join(storeRoot, subdir);
		await mkdir(join(dataDir, TICKETS_DIR), { recursive: true });
		const storeRemote = await gitRemote(storeRoot);
		return {
			kind: 'git',
			scope: 'central',
			dataDir,
			branch: await gitBranch(storeRoot),
			remote: storeRemote,
			pushEnabled: Boolean(storeRemote),
		};
	}
	// repo-git (default): relocated orphan `tickets` worktree under worktreesRoot.
	const dataDir = join(worktreesRoot, subdir);
	if (!(await pathExists(join(dataDir, '.git')))) {
		await mkdir(worktreesRoot, { recursive: true });
		if (await branchExists(repoPath, DATA_BRANCH)) {
			await exec('git', ['worktree', 'add', dataDir, DATA_BRANCH], repoPath);
		} else {
			await exec('git', ['worktree', 'add', '--orphan', '-b', DATA_BRANCH, dataDir], repoPath);
			await exec('git', ['commit', '--allow-empty', '--no-verify', '-m', 'Initialize tickets data branch'], dataDir);
		}
	}
	return {
		kind: 'git',
		scope: 'repo',
		dataDir,
		branch: DATA_BRANCH,
		remote: await gitRemote(dataDir),
		pushEnabled: true,
	};
};

/**
 * Registers the repo containing `cwd`. New git stores are self-describing (a
 * committed `.tickets-store.json` marker) so identity survives renames/reclone.
 * One repo maps to one store: re-running init refreshes the name and reuses the
 * existing store rather than creating a duplicate.
 */
export const initProject = async (options: InitOptions): Promise<ProjectEntry> => {
	const config = await readDaemonConfig(options.configPath);
	const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], options.cwd);
	const repoPath = stdout.trim();
	const name = options.name ?? basename(repoPath);
	const setup: StoreSetup = options.into ?? (options.adapter === 'folder' ? 'repo-folder' : 'repo-git');
	const storeRoot = options.storeRoot ?? config.storeRoot;
	const worktreesRoot = options.worktreesRoot ?? config.worktreesRoot;

	const existing = config.projects.find((project) => project.repoPath === repoPath);
	const existingLocation = existing ? projectLocation(existing) : undefined;

	let location: StoreLocation;
	let id: string;
	if (existing && existingLocation && (await pathExists(existingLocation.dataDir))) {
		// Idempotent re-init: keep the store + identity, refresh the display name.
		location = existingLocation;
		id = existing.id ?? (await readMarker(location.dataDir))?.id ?? generateProjectId();
	} else {
		id = existing?.id ?? generateProjectId();
		location = await provisionStore({
			setup,
			repoPath,
			storeRoot,
			worktreesRoot,
			subdir: projectSubdir(id, name),
			remote: options.remote,
		});
	}

	await writeAndCommitMarker(location.dataDir, {
		schemaVersion: 1,
		id,
		name,
		kind: location.kind,
		repoRemote: location.remote,
		createdAt: new Date().toISOString(),
	});

	const entry: ProjectEntry = { id, name, repoPath, location };
	const existingIndex = config.projects.findIndex(
		(project) => project.repoPath === repoPath || (project.id !== undefined && project.id === id),
	);
	if (existingIndex >= 0) config.projects[existingIndex] = entry;
	else config.projects.push(entry);
	await writeDaemonConfig(config, options.configPath);
	return entry;
};
