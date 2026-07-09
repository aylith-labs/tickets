import type { Ticket } from './Ticket';
import type { TicketCreateInput } from './TicketCreateInput';
import type { TicketPatch } from './TicketPatch';
import type { TicketRevision } from './TicketRevision';

export interface StorageAdapter {
	list(): Promise<Ticket[]>;
	get(id: string): Promise<Ticket | null>;
	create(input: TicketCreateInput): Promise<Ticket>;
	update(id: string, patch: TicketPatch, message?: string): Promise<Ticket>;
	archive(id: string): Promise<Ticket>;
	/** Newest first. Adapters without versioning return []. */
	getRevisions(id: string): Promise<TicketRevision[]>;
	getRevision(id: string, ref: string): Promise<Ticket | null>;
	restoreRevision(id: string, ref: string): Promise<Ticket>;
}
