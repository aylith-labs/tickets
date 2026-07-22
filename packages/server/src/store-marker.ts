import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from '@aylith/tickets-core';
import type { StoreMarker } from './types/StoreMarker';

export const MARKER_FILE = '.tickets-store.json';

export const markerPath = (dataDir: string): string => join(dataDir, MARKER_FILE);

export const readMarker = async (dataDir: string): Promise<StoreMarker | null> => {
	try {
		return JSON.parse(await readFile(markerPath(dataDir), 'utf8')) as StoreMarker;
	} catch {
		return null;
	}
};

export const writeMarker = async (dataDir: string, marker: StoreMarker): Promise<void> => {
	await writeFile(markerPath(dataDir), `${JSON.stringify(marker, null, '\t')}\n`, 'utf8');
};

/** Writes the marker and, for a git store, commits it so the id travels on reclone. */
export const writeAndCommitMarker = async (dataDir: string, marker: StoreMarker): Promise<void> => {
	await writeMarker(dataDir, marker);
	if (marker.kind !== 'git') return;
	try {
		await exec('git', ['add', '--', MARKER_FILE], dataDir);
		await exec(
			'git',
			['commit', '--no-verify', '-m', `Register tickets store ${marker.id}`, '--', MARKER_FILE],
			dataDir,
		);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		if (!text.includes('nothing to commit') && !text.includes('nothing added to commit')) throw error;
	}
};
