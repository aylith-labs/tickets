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
	/** Serializes index-mutating git work per repository root, across all instances. */
	private static readonly gitQueues = new Map<string, Promise<unknown>>();
	private rootCache?: Promise<string>;

	constructor(options: GitBranchAdapterOptions) {
		super(options);
		this.pushEnabled = options.push ?? true;
	}

	private git(args: string[]) {
		return exec('git', args, this.dataDir);
	}

	/** Absolute git top-level of this store — the serialization key (cached). */
	private gitRoot(): Promise<string> {
		this.rootCache ??= this.git(['rev-parse', '--show-toplevel']).then(({ stdout }) => stdout.trim());
		return this.rootCache;
	}

	/**
	 * Runs `task` after any prior git work on the same repo root has settled.
	 * Central stores put many project subfolders in one repo, so their commits
	 * and pushes share a single `.git/index` and must not overlap. Per-repo
	 * worktrees resolve to distinct roots and keep full parallelism.
	 */
	private async withGitLock<Result>(task: () => Promise<Result>): Promise<Result> {
		const root = await this.gitRoot();
		const prior = GitBranchAdapter.gitQueues.get(root) ?? Promise.resolve();
		const run = prior.then(task, task);
		GitBranchAdapter.gitQueues.set(
			root,
			run.catch(() => undefined),
		);
		return run;
	}

	async getRevisions(id: string): Promise<TicketRevision[]> {
		const relativePath = this.ticketRelativePath(id);
		try {
			// No `--follow`: ticket files are never renamed, and in a central store
			// its rename detection would leak a sibling project's same-id history.
			const { stdout } = await this.git(['log', '--format=%H%x09%aI%x09%s', '--', relativePath]);
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
		// The file write above is subfolder-scoped and collision-free; only the
		// shared-index add+commit needs the per-root lock.
		await this.withGitLock(async () => {
			await this.git(['add', '--', relativePath]);
			try {
				await this.git(['commit', '--no-verify', '-m', message, '--', relativePath]);
			} catch (error) {
				// A patch that results in identical content has nothing to commit — not an error.
				const text = error instanceof Error ? error.message : String(error);
				if (!text.includes('nothing to commit') && !text.includes('nothing added to commit')) throw error;
			}
		});
		if (this.pushEnabled) this.schedulePush();
	}

	/** Best-effort push routed through the per-root lock; failures are logged, never thrown. */
	private schedulePush(): void {
		this.pushChain = this.withGitLock(async () => {
			try {
				const { stdout } = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
				const branch = stdout.trim();
				await this.git(['push', '--no-verify', '-u', 'origin', branch]);
			} catch (error) {
				console.warn(`tickets: push failed for ${this.dataDir}:`, error instanceof Error ? error.message : error);
			}
		});
	}

	/** Await any queued work on this store's repo root (used by tests and graceful shutdown). */
	async flush(): Promise<void> {
		await this.pushChain;
		await (GitBranchAdapter.gitQueues.get(await this.gitRoot()) ?? Promise.resolve());
	}
}
