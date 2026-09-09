import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { exec } from '@aylith/tickets-core';
import { projectLocation } from './registry';
import { readMarker } from './store-marker';
import type { DaemonConfig } from './types/DaemonConfig';

/** Select existing identities without discovery, repair, config writes or Git pushes. */
export const localStartupConfig = async (config: DaemonConfig, projectIds: string[]): Promise<DaemonConfig> => {
	if (projectIds.length === 0 || projectIds.some((id) => !id.trim())) {
		throw new Error('--local requires at least one exact --project-id');
	}
	if (new Set(projectIds).size !== projectIds.length) throw new Error('Duplicate --project-id');

	// Resolve the entire selection before touching any store. Never fall back to names.
	const projects = projectIds.map((id) => {
		const matches = config.projects.filter((project) => project.id === id);
		const project = matches[0];
		if (matches.length !== 1 || !project)
			throw new Error(`Project ID "${id}" must match exactly one registered project`);
		if (project.unavailable)
			throw new Error(`Project ID "${id}" is marked unavailable; local startup cannot repair it`);
		const location = projectLocation(project);
		if (
			!['git', 'folder'].includes(location.kind) ||
			!['repo', 'central'].includes(location.scope) ||
			typeof location.dataDir !== 'string' ||
			!isAbsolute(location.dataDir) ||
			typeof project.repoPath !== 'string' ||
			!isAbsolute(project.repoPath) ||
			typeof project.name !== 'string' ||
			!project.name.trim() ||
			(location.branch !== undefined && (typeof location.branch !== 'string' || !location.branch.trim())) ||
			(location.remote !== undefined && typeof location.remote !== 'string') ||
			(location.pushEnabled !== undefined && typeof location.pushEnabled !== 'boolean') ||
			(location.scope === 'central' && (typeof config.storeRoot !== 'string' || !isAbsolute(config.storeRoot)))
		)
			throw new Error(`Project ID "${id}" has an invalid storage configuration`);
		return {
			...project,
			location: location.kind === 'git' ? { ...location, pushEnabled: false } : { ...location },
		};
	});
	for (const project of projects) {
		const { location } = project;
		const marker = await readMarker(location.dataDir);
		if (marker?.schemaVersion !== 1 || marker.id !== project.id || marker.kind !== location.kind) {
			throw new Error(`Project ID "${project.id}" requires a matching store marker at its configured data directory`);
		}
		if (location.kind === 'git') {
			try {
				const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], location.dataDir);
				const expectedRoot = location.scope === 'central' ? config.storeRoot : location.dataDir;
				if ((await realpath(stdout.trim())) !== (await realpath(expectedRoot))) throw new Error('Wrong Git root');
				if (location.branch !== undefined) {
					const { stdout: branch } = await exec('git', ['symbolic-ref', '--short', 'HEAD'], location.dataDir);
					if (branch.trim() !== location.branch) throw new Error('Wrong Git branch');
				}
			} catch {
				throw new Error(
					`Project ID "${project.id}" requires a working Git store at its configured root and branch; local startup cannot repair it`,
				);
			}
		}
	}
	// These actions can run arbitrary commands or publish outside the selected stores.
	// Keep local mode closed for its entire lifetime, including later HTTP requests.
	return {
		...config,
		projects,
		terminals: [],
		enrich: { defaultProvider: '', providers: [] },
		media: undefined,
		onStatusChange: undefined,
	};
};
