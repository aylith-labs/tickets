import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from '@aylith/tickets-core';
import { generateProjectId } from './identity';
import { projectLocation, writeDaemonConfig } from './registry';
import { readMarker, writeAndCommitMarker } from './store-marker';
import type { DaemonConfig } from './types/DaemonConfig';
import type { ProjectEntry } from './types/ProjectEntry';
import type { StoreMarker } from './types/StoreMarker';

export type ReconcileDiagnostic =
	| { kind: 'minted-id'; id: string; name: string }
	| { kind: 'healed-datadir'; id: string; from: string; to: string }
	| { kind: 'store-missing'; name: string; reason: string }
	| { kind: 'adoptable'; id: string; name: string; path: string };

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const gitDirOk = async (dataDir: string): Promise<boolean> =>
	exec('git', ['rev-parse', '--git-dir'], dataDir)
		.then(() => true)
		.catch(() => false);

/** Relink a worktree whose absolute gitdir pointer broke when the repo dir moved. */
const gitWorktreeRepair = async (entry: ProjectEntry, dataDir: string): Promise<void> => {
	try {
		if (await pathExists(entry.repoPath)) await exec('git', ['worktree', 'repair', dataDir], entry.repoPath);
		await exec('git', ['worktree', 'repair'], dataDir);
	} catch {
		// best effort — surfaced as unavailable if the store still can't be read
	}
};

const indexMarkers = async (roots: string[]): Promise<Map<string, { path: string; marker: StoreMarker }>> => {
	const byId = new Map<string, { path: string; marker: StoreMarker }>();
	for (const root of roots) {
		let entries: string[];
		try {
			entries = await readdir(root);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(root, entry);
			const marker = await readMarker(path);
			if (marker && !byId.has(marker.id)) byId.set(marker.id, { path, marker });
		}
	}
	return byId;
};

/**
 * Heals `config.json` against what's actually on disk, matching by the stable
 * `id`: mints ids + markers for legacy entries, re-finds stores that moved,
 * repairs worktrees whose repo moved, and marks entries whose store is gone
 * (never dropping them). Surfaces orphan stores as adoptable.
 */
export const reconcileProjects = async (
	config: DaemonConfig,
	options: { persist?: boolean; configPath?: string } = {},
): Promise<{ config: DaemonConfig; diagnostics: ReconcileDiagnostic[] }> => {
	const diagnostics: ReconcileDiagnostic[] = [];
	let changed = false;

	// (0) Mint id + marker for legacy entries (reusing a store's committed id if present).
	for (const entry of config.projects) {
		if (entry.id) continue;
		const location = projectLocation(entry);
		const marker = await readMarker(location.dataDir);
		entry.id = marker?.id ?? generateProjectId();
		if (!marker && (await pathExists(location.dataDir))) {
			await writeAndCommitMarker(location.dataDir, {
				schemaVersion: 1,
				id: entry.id,
				name: entry.name,
				kind: location.kind,
				createdAt: new Date().toISOString(),
			});
		}
		diagnostics.push({ kind: 'minted-id', id: entry.id, name: entry.name });
		changed = true;
	}

	const byId = await indexMarkers([config.storeRoot, config.worktreesRoot]);

	// (1) Reconcile each entry by id.
	for (const entry of config.projects) {
		const location = projectLocation(entry);
		const here = await readMarker(location.dataDir);
		const found = here?.id === entry.id ? { path: location.dataDir } : entry.id ? byId.get(entry.id) : undefined;

		if (found && found.path !== location.dataDir) {
			if (entry.location) entry.location = { ...entry.location, dataDir: found.path };
			if (projectLocation(entry).kind === 'git') await gitWorktreeRepair(entry, found.path);
			diagnostics.push({ kind: 'healed-datadir', id: entry.id ?? '', from: location.dataDir, to: found.path });
			if (entry.unavailable) delete entry.unavailable;
			changed = true;
			continue;
		}

		if (!found && !(await pathExists(location.dataDir))) {
			if (entry.unavailable !== 'store folder not found') changed = true;
			entry.unavailable = 'store folder not found';
			diagnostics.push({ kind: 'store-missing', name: entry.name, reason: entry.unavailable });
			continue;
		}

		if (location.kind === 'git' && !(await gitDirOk(location.dataDir))) {
			if (await pathExists(entry.repoPath)) {
				await gitWorktreeRepair(entry, location.dataDir);
			} else {
				entry.unavailable = 'repository moved or missing';
				diagnostics.push({ kind: 'store-missing', name: entry.name, reason: entry.unavailable });
				changed = true;
				continue;
			}
		}

		if (entry.unavailable) {
			delete entry.unavailable;
			changed = true;
		}
	}

	// (2) Stores present on disk but absent from config — surface, never auto-adopt.
	const configIds = new Set(config.projects.map((project) => project.id));
	for (const [id, store] of byId) {
		if (!configIds.has(id)) diagnostics.push({ kind: 'adoptable', id, name: store.marker.name, path: store.path });
	}

	if (options.persist && changed) await writeDaemonConfig(config, options.configPath);
	return { config, diagnostics };
};
