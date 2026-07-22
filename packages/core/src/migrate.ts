import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TICKETS_DIR } from './constants';
import { exec } from './exec';
import { parseTicket, serializeTicket } from './markdown';
import type { StoreLocation } from './types/StoreLocation';

export type MigrateResult = { copied: string[] };

/**
 * Copies every ticket markdown file from `from` to `to` (attachments are remote
 * URLs in frontmatter, so nothing binary is copied) and commits at a git
 * destination. Non-destructive: `from` is never touched. Ids are preserved
 * verbatim — central subfolder namespacing keeps them collision-free.
 */
export const migrateTickets = async (from: StoreLocation, to: StoreLocation): Promise<MigrateResult> => {
	const sourceDir = join(from.dataDir, TICKETS_DIR);
	const destDir = join(to.dataDir, TICKETS_DIR);
	let entries: string[];
	try {
		entries = (await readdir(sourceDir)).filter((name) => name.endsWith('.md'));
	} catch {
		entries = [];
	}
	await mkdir(destDir, { recursive: true });
	const copied: string[] = [];
	for (const entry of entries) {
		const ticket = parseTicket(await readFile(join(sourceDir, entry), 'utf8'));
		await writeFile(join(destDir, entry), serializeTicket(ticket), 'utf8');
		copied.push(ticket.id);
	}

	if (to.kind === 'git' && copied.length > 0) {
		await exec('git', ['add', '--', TICKETS_DIR], to.dataDir);
		try {
			await exec('git', ['commit', '--no-verify', '-m', 'Migrate tickets (current state)'], to.dataDir);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			if (!text.includes('nothing to commit') && !text.includes('nothing added to commit')) throw error;
		}
		if (to.pushEnabled) {
			try {
				const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], to.dataDir);
				await exec('git', ['push', '--no-verify', '-u', 'origin', stdout.trim()], to.dataDir);
			} catch (error) {
				console.warn(`tickets: migrate push failed:`, error instanceof Error ? error.message : error);
			}
		}
	}
	return { copied };
};
