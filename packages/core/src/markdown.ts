import matter from 'gray-matter';
import type { Attachment } from './types/Attachment';
import type { Ticket } from './types/Ticket';

const toIsoString = (value: unknown): string | undefined => {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string' && value.length > 0) return value;
	return undefined;
};

const toAttachment = (value: unknown): Attachment | null => {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.url !== 'string') return null;
	const kind = record.kind === 'before' || record.kind === 'after' ? record.kind : 'other';
	const type = record.type === 'video' ? 'video' : 'image';
	const attachment: Attachment = { url: record.url, kind, type };
	if (typeof record.label === 'string') attachment.label = record.label;
	return attachment;
};

export const parseTicket = (raw: string): Ticket => {
	const { data, content } = matter(raw);
	const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
	return {
		id: String(data.id ?? ''),
		title: typeof data.title === 'string' ? data.title : String(data.title ?? ''),
		status: typeof data.status === 'string' ? data.status : 'todo',
		archived: data.archived === true,
		created: toIsoString(data.created) ?? new Date(0).toISOString(),
		updated: toIsoString(data.updated),
		attachments: attachmentsRaw.map(toAttachment).filter((item): item is Attachment => item !== null),
		description: content.trim(),
	};
};

export const serializeTicket = (ticket: Ticket): string => {
	const frontmatter: Record<string, unknown> = {
		id: ticket.id,
		title: ticket.title,
		status: ticket.status,
		archived: ticket.archived,
		created: ticket.created,
	};
	if (ticket.updated) frontmatter.updated = ticket.updated;
	if (ticket.attachments.length > 0)
		frontmatter.attachments = ticket.attachments.map((attachment) => ({ ...attachment }));
	const body = ticket.description.length > 0 ? `${ticket.description.trim()}\n` : '';
	return matter.stringify(body, frontmatter);
};
