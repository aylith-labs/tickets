import type { Attachment } from './Attachment';

export type TicketPatch = {
	title?: string;
	description?: string;
	status?: string;
	archived?: boolean;
	attachments?: Attachment[];
};
