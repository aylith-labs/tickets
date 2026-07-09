import type { Attachment } from './Attachment';

export type Ticket = {
	id: string;
	title: string;
	/** One of the configured status ids (see DEFAULT_STATUSES). */
	status: string;
	archived: boolean;
	/** ISO 8601 UTC. */
	created: string;
	/** ISO 8601 UTC. */
	updated?: string;
	attachments: Attachment[];
	/** Markdown body of the ticket file. */
	description: string;
};
