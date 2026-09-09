import type { TicketWithProject } from './client';

export const ticketProjectKey = (ticket: TicketWithProject): string => ticket.projectId ?? ticket.project;

/** A deep link requires exact stable IDs. Names and first-match selection are insufficient. */
export function linkedTicket(
	tickets: TicketWithProject[],
	projectId: string,
	ticketId: string,
): TicketWithProject | undefined {
	if (!projectId || !/^\d{1,16}$/.test(ticketId)) return undefined;
	const matches = tickets.filter((ticket) => ticket.projectId === projectId && ticket.id === ticketId);
	return matches.length === 1 ? matches[0] : undefined;
}
