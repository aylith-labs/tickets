import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exec, migrateTickets, type StoreLocation } from '@aylith/tickets-core';
import { generateProjectId, projectSubdir } from './identity';
import { branchExists, DATA_BRANCH, provisionStore, remoteBranchExists } from './init';
import { projectLocation, readDaemonConfig, writeDaemonConfig } from './registry';
import { readMarker, writeAndCommitMarker } from './store-marker';
import type { DaemonConfig } from './types/DaemonConfig';
import type { ProjectEntry } from './types/ProjectEntry';
import type { StoreSetup } from './types/StoreSetup';

const pathExists = (path: string): Promise<boolean> =>
	access(path).then(
		() => true,
		() => false,
	);

export type MigrateOptions = {
	selector: string;
	to: StoreSetup;
	remote?: string;
	cleanup?: boolean;
	configPath?: string;
	storeRoot?: string;
	worktreesRoot?: string;
};

export type MigrateOutcome = {
	name: string;
	from: StoreLocation;
	to: StoreLocation;
	copied: number;
	moved: boolean;
	unchanged: boolean;
	cleaned: boolean;
	cleanupSkipped?: string;
};

const findProject = (config: DaemonConfig, selector: string): ProjectEntry | undefined =>
	config.projects.find((project) => project.id === selector) ??
	config.projects.find((project) => project.name === selector);

const isFullyPushed = async (dataDir: string): Promise<boolean> => {
	try {
		const { stdout } = await exec('git', ['rev-list', '@{u}..HEAD', '--count'], dataDir);
		return stdout.trim() === '0';
	} catch {
		return false; // no upstream — can't confirm the data is safe elsewhere
	}
};

/** Removes the old store, but only when the data is provably safe (pushed, or a plain folder). */
const cleanupOldStore = async (from: StoreLocation, repoPath: string): Promise<string | undefined> => {
	if (from.kind === 'folder') {
		await rm(from.dataDir, { recursive: true, force: true });
		return undefined;
	}
	if (!(await isFullyPushed(from.dataDir))) return 'source has unpushed commits (or no remote)';
	if (from.scope === 'repo') {
		await exec('git', ['worktree', 'remove', '--force', from.dataDir], repoPath).catch(() => undefined);
		await exec('git', ['branch', '-D', from.branch ?? 'tickets'], repoPath).catch(() => undefined);
	} else {
		await rm(from.dataDir, { recursive: true, force: true });
	}
	return undefined;
};

/**
 * Re-homes one project to a different setup. Relocating a per-repo git store
 * moves the worktree (branch/history/remote intact); every other transition
 * copies the current ticket state into the target store (non-destructive).
 */
export const migrateProject = async (options: MigrateOptions): Promise<MigrateOutcome> => {
	const config = await readDaemonConfig(options.configPath);
	const entry = findProject(config, options.selector);
	if (!entry) throw new Error(`Unknown project ${options.selector}`);

	const from = projectLocation(entry);
	const id = entry.id ?? (await readMarker(from.dataDir))?.id ?? generateProjectId();
	const storeRoot = options.storeRoot ?? config.storeRoot;
	const worktreesRoot = options.worktreesRoot ?? config.worktreesRoot;
	const subdir = projectSubdir(id, entry.name);

	// Relocate a per-repo git worktree in place — no ticket copy, keep the branch.
	if (from.kind === 'git' && from.scope === 'repo' && options.to === 'repo-git') {
		const branch = from.branch ?? DATA_BRANCH;
		const newDataDir = join(worktreesRoot, subdir);
		const sourcePresent = await pathExists(join(from.dataDir, '.git'));
		if (newDataDir === from.dataDir && sourcePresent) {
			return { name: entry.name, from, to: from, copied: 0, moved: false, unchanged: true, cleaned: false };
		}
		await mkdir(dirname(newDataDir), { recursive: true });
		if (sourcePresent) {
			await exec('git', ['worktree', 'move', from.dataDir, newDataDir], entry.repoPath);
		} else if (await branchExists(entry.repoPath, branch)) {
			// Worktree gone but the local branch remains — re-attach it at the new location.
			await exec('git', ['worktree', 'add', newDataDir, branch], entry.repoPath);
		} else if (await remoteBranchExists(entry.repoPath, branch)) {
			// Worktree and local branch gone but the data is on origin — recreate it.
			await exec('git', ['worktree', 'add', '--track', '-b', branch, newDataDir, `origin/${branch}`], entry.repoPath);
		} else {
			throw new Error(`Cannot relocate ${entry.name}: worktree missing at ${from.dataDir} and no origin/${branch}`);
		}
		const to: StoreLocation = { ...from, dataDir: newDataDir };
		// A committed marker moves with the worktree; only a legacy store lacks one.
		if (!(await readMarker(newDataDir))) {
			await writeAndCommitMarker(newDataDir, {
				schemaVersion: 1,
				id,
				name: entry.name,
				kind: to.kind,
				repoRemote: to.remote,
				createdAt: new Date().toISOString(),
			});
		}
		entry.id = id;
		entry.location = to;
		delete entry.unavailable;
		await writeDaemonConfig(config, options.configPath);
		return { name: entry.name, from, to, copied: 0, moved: true, unchanged: false, cleaned: false };
	}

	const to = await provisionStore({
		setup: options.to,
		repoPath: entry.repoPath,
		storeRoot,
		worktreesRoot,
		subdir,
		remote: options.remote,
	});
	if (to.dataDir === from.dataDir) {
		return { name: entry.name, from, to, copied: 0, moved: false, unchanged: true, cleaned: false };
	}

	const { copied } = await migrateTickets(from, to);
	await writeAndCommitMarker(to.dataDir, {
		schemaVersion: 1,
		id,
		name: entry.name,
		kind: to.kind,
		repoRemote: to.remote,
		createdAt: new Date().toISOString(),
	});
	entry.id = id;
	entry.location = to;
	delete entry.unavailable;
	await writeDaemonConfig(config, options.configPath);

	let cleaned = false;
	let cleanupSkipped: string | undefined;
	if (options.cleanup) {
		cleanupSkipped = await cleanupOldStore(from, entry.repoPath);
		cleaned = !cleanupSkipped;
	}
	return { name: entry.name, from, to, copied: copied.length, moved: false, unchanged: false, cleaned, cleanupSkipped };
};

export type ConvergeOptions = {
	setup: 'central-git' | 'central-folder';
	remote?: string;
	cleanup?: boolean;
	configPath?: string;
	storeRoot?: string;
	worktreesRoot?: string;
};

/** Migrates every per-repo project into the central store. */
export const convergeProjects = async (options: ConvergeOptions): Promise<MigrateOutcome[]> => {
	const config = await readDaemonConfig(options.configPath);
	const repoScoped = config.projects.filter((project) => projectLocation(project).scope === 'repo');
	const outcomes: MigrateOutcome[] = [];
	for (const project of repoScoped) {
		outcomes.push(
			await migrateProject({
				selector: project.id ?? project.name,
				to: options.setup,
				remote: options.remote,
				cleanup: options.cleanup,
				configPath: options.configPath,
				storeRoot: options.storeRoot,
				worktreesRoot: options.worktreesRoot,
			}),
		);
	}
	return outcomes;
};

/** Renames a project's display name and refreshes its store marker. */
export const renameProject = async (selector: string, newName: string, configPath?: string): Promise<ProjectEntry> => {
	const config = await readDaemonConfig(configPath);
	const entry = findProject(config, selector);
	if (!entry) throw new Error(`Unknown project ${selector}`);
	entry.name = newName;
	const location = projectLocation(entry);
	const marker = await readMarker(location.dataDir);
	if (marker) await writeAndCommitMarker(location.dataDir, { ...marker, name: newName });
	await writeDaemonConfig(config, configPath);
	return entry;
};

/** Registers an on-disk store (one reconcile surfaced as adoptable) back into the config. */
export const adoptStore = async (dataDir: string, options: { configPath?: string } = {}): Promise<ProjectEntry> => {
	const marker = await readMarker(dataDir);
	if (!marker) throw new Error(`No .tickets-store.json marker at ${dataDir}`);
	const config = await readDaemonConfig(options.configPath);
	const existing = config.projects.find((project) => project.id === marker.id);
	if (existing) throw new Error(`Project ${marker.id} ("${existing.name}") is already registered`);

	const scope = dataDir.startsWith(config.storeRoot) ? 'central' : 'repo';
	let repoPath: string;
	let location: StoreLocation;
	if (marker.kind === 'git') {
		// --git-common-dir points at the owning repo's .git (the consuming repo for a
		// worktree, the store repo for a central subfolder).
		const commonDir = await exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], dataDir).then(
			({ stdout }) => stdout.trim(),
		);
		repoPath = dirname(commonDir);
		const branch = await exec('git', ['symbolic-ref', '--short', 'HEAD'], dataDir)
			.then(({ stdout }) => stdout.trim() || DATA_BRANCH)
			.catch(() => DATA_BRANCH);
		const remote = await exec('git', ['remote', 'get-url', 'origin'], dataDir)
			.then(({ stdout }) => stdout.trim() || undefined)
			.catch(() => undefined);
		location = { kind: 'git', scope, dataDir, branch, remote, pushEnabled: scope === 'repo' || Boolean(remote) };
	} else {
		repoPath = dirname(dataDir);
		location = { kind: 'folder', scope, dataDir };
	}

	const entry: ProjectEntry = { id: marker.id, name: marker.name, repoPath, location };
	config.projects.push(entry);
	await writeDaemonConfig(config, options.configPath);
	return entry;
};
