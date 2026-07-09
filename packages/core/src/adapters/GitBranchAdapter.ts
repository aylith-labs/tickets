import { exec } from '../exec';
import { parseTicket } from '../markdown';
import type { Ticket } from '../types/Ticket';
import type { TicketRevision } from '../types/TicketRevision';
import { FolderAdapter, type FolderAdapterOptions } from './FolderAdapter';

export type GitBranchAdapterOptions = FolderAdapterOptions & {
	/** Push the data branch after each mutation (best-effort). Default true. */
	push?: boolean;
};

/**
 * Git-backed storage: dataDir is a worktree (typically of an orphan `tickets`
 * branch). Every mutation is one commit; revisions and undo come from git.
 */
export class GitBranchAdapter extends FolderAdapter {
	private readonly pushEnabled: boolean;
	private pushChain: Promise<void> = Promise.resolve();

	constructor(options: GitBranchAdapterOptions) {
		super(options);
		this.pushEnabled = options.push ?? true;
	}

	private git(args: string[]) {
		return exec('git', args, this.dataDir);
	}

	async getRevisions(id: string): Promise<TicketRevision[]> {
		const relativePath = this.ticketRelativePath(id);
		try {
			const { stdout } = await this.git(['log', '--follow', '--format=%H%x09%aI%x09%s', '--', relativePath]);
			return stdout
				.split('\n')
				.filter((line) => line.length > 0)
				.map((line) => {
					const [ref = '', at = '', ...rest] = line.split('\t');
					return { ref, at, message: rest.join('\t') };
				});
		} catch {
			return [];
		}
	}

	async getRevision(id: string, ref: string): Promise<Ticket | null> {
		try {
			const { stdout } = await this.git(['show', `${ref}:./${this.ticketRelativePath(id)}`]);
			return parseTicket(stdout);
		} catch {
			return null;
		}
	}

	async restoreRevision(id: string, ref: string): Promise<Ticket> {
		const revision = await this.getRevision(id, ref);
		if (!revision) throw new Error(`Revision ${ref} of ticket ${id} not found`);
		const current = await this.get(id);
		if (!current) throw new Error(`Ticket ${id} not found`);
		// Keep runtime state (status/archived/attachments); restore the authored content.
		return this.update(
			id,
			{ title: revision.title, description: revision.description },
			`Restore ticket ${id} to ${ref.slice(0, 8)}`,
		);
	}

	protected override async persist(ticket: Ticket, message: string): Promise<void> {
		await super.persist(ticket, message);
		const relativePath = this.ticketRelativePath(ticket.id);
		await this.git(['add', '--', relativePath]);
		try {
			await this.git(['commit', '--no-verify', '-m', message, '--', relativePath]);
		} catch (error) {
			// A patch that results in identical content has nothing to commit — not an error.
			const text = error instanceof Error ? error.message : String(error);
			if (!text.includes('nothing to commit') && !text.includes('nothing added to commit')) throw error;
		}
		if (this.pushEnabled) this.schedulePush();
	}

	/** Serialized best-effort push; failures are logged, never thrown. */
	private schedulePush(): void {
		this.pushChain = this.pushChain.then(async () => {
			try {
				const { stdout } = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
				const branch = stdout.trim();
				await this.git(['push', '--no-verify', '-u', 'origin', branch]);
			} catch (error) {
				console.warn(`tickets: push failed for ${this.dataDir}:`, error instanceof Error ? error.message : error);
			}
		});
	}

	/** Await any queued pushes (used by tests and graceful shutdown). */
	async flush(): Promise<void> {
		await this.pushChain;
	}
}
