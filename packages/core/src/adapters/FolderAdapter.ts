import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_STATUS, TICKETS_DIR } from '../constants';
import { nextTicketId } from '../id';
import { parseTicket, serializeTicket } from '../markdown';
import type { StorageAdapter } from '../types/StorageAdapter';
import type { Ticket } from '../types/Ticket';
import type { TicketCreateInput } from '../types/TicketCreateInput';
import type { TicketPatch } from '../types/TicketPatch';
import type { TicketRevision } from '../types/TicketRevision';

export type FolderAdapterOptions = {
	/** Directory containing the `tickets/` folder. */
	dataDir: string;
	defaultStatus?: string;
};

/** `exclusive` fails the write when the ticket file already exists, instead of overwriting it. */
export type PersistOptions = { exclusive?: boolean };

const ID_ALLOCATION_ATTEMPTS = 25;

const isAlreadyExists = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';

/** Plain-folder storage: markdown files, no versioning (revisions are empty). */
export class FolderAdapter implements StorageAdapter {
	protected readonly dataDir: string;
	protected readonly ticketsDir: string;
	protected readonly defaultStatus: string;
	private createQueue: Promise<unknown> = Promise.resolve();

	constructor(options: FolderAdapterOptions) {
		this.dataDir = options.dataDir;
		this.ticketsDir = join(options.dataDir, TICKETS_DIR);
		this.defaultStatus = options.defaultStatus ?? DEFAULT_STATUS;
	}

	protected ticketPath(id: string): string {
		return join(this.ticketsDir, `${id}.md`);
	}

	/** Path of a ticket file relative to dataDir (used by git operations). */
	protected ticketRelativePath(id: string): string {
		return `${TICKETS_DIR}/${id}.md`;
	}

	async list(): Promise<Ticket[]> {
		let entries: string[];
		try {
			entries = await readdir(this.ticketsDir);
		} catch {
			return [];
		}
		const tickets: Ticket[] = [];
		for (const entry of entries) {
			if (!entry.endsWith('.md')) continue;
			const raw = await readFile(join(this.ticketsDir, entry), 'utf8');
			tickets.push(parseTicket(raw));
		}
		tickets.sort((first, second) => second.id.localeCompare(first.id));
		return tickets;
	}

	async get(id: string): Promise<Ticket | null> {
		try {
			const raw = await readFile(this.ticketPath(id), 'utf8');
			return parseTicket(raw);
		} catch {
			return null;
		}
	}

	/**
	 * Ids are derived by scanning the existing tickets, so two creates that
	 * interleave would allocate the same id. They run one at a time, and the
	 * first write refuses to clobber an existing file — a concurrent writer
	 * outside this process costs a retry rather than a lost ticket.
	 */
	async create(input: TicketCreateInput): Promise<Ticket> {
		const run = this.createQueue.then(
			() => this.createOne(input),
			() => this.createOne(input),
		);
		this.createQueue = run.catch(() => undefined);
		return run;
	}

	private async createOne(input: TicketCreateInput): Promise<Ticket> {
		await mkdir(this.ticketsDir, { recursive: true });
		for (let attempt = 0; attempt < ID_ALLOCATION_ATTEMPTS; attempt++) {
			const existing = await this.list();
			const ticket: Ticket = {
				id: nextTicketId(existing.map((item) => item.id)),
				title: input.title,
				status: input.status ?? this.defaultStatus,
				archived: false,
				created: new Date().toISOString(),
				attachments: [],
				description: input.description ?? '',
			};
			try {
				await this.persist(ticket, `Create ticket ${ticket.id}`, { exclusive: true });
				return ticket;
			} catch (error) {
				if (!isAlreadyExists(error)) throw error;
			}
		}
		throw new Error(`Could not allocate a free ticket id in ${this.ticketsDir}`);
	}

	async update(id: string, patch: TicketPatch, message?: string): Promise<Ticket> {
		const current = await this.get(id);
		if (!current) throw new Error(`Ticket ${id} not found`);
		const updated: Ticket = {
			...current,
			...patch,
			id: current.id,
			created: current.created,
			updated: new Date().toISOString(),
		};
		await this.persist(updated, message ?? `Update ticket ${id}`);
		return updated;
	}

	async archive(id: string): Promise<Ticket> {
		return this.update(id, { archived: true }, `Archive ticket ${id}`);
	}

	async getRevisions(_id: string): Promise<TicketRevision[]> {
		return [];
	}

	async getRevision(_id: string, _ref: string): Promise<Ticket | null> {
		return null;
	}

	async restoreRevision(id: string, _ref: string): Promise<Ticket> {
		throw new Error(`Adapter has no revision history (ticket ${id})`);
	}

	protected async persist(ticket: Ticket, _message: string, options: PersistOptions = {}): Promise<void> {
		await mkdir(this.ticketsDir, { recursive: true });
		await writeFile(this.ticketPath(ticket.id), serializeTicket(ticket), {
			encoding: 'utf8',
			flag: options.exclusive ? 'wx' : 'w',
		});
	}
}
