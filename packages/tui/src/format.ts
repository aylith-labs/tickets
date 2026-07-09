import type { TicketWithProject } from '@aylith/tickets-core';

export type StatusColor = 'gray' | 'blue' | 'yellow' | 'green' | 'white';

export const statusColor = (status: string): StatusColor => {
	switch (status) {
		case 'in_progress':
			return 'blue';
		case 'in_review':
			return 'yellow';
		case 'done':
			return 'green';
		case 'todo':
			return 'gray';
		default:
			return 'white';
	}
};

/** Compact relative age, e.g. "3m", "5h", "2d", "now". */
export const relativeTime = (iso?: string): string => {
	if (!iso) return '—';
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return '—';
	const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
	if (seconds < 60) return 'now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(months / 12)}y`;
};

export type ProjectGroup = { project: string; tickets: TicketWithProject[] };

/** Group tickets by project, projects alphabetical, tickets by id descending. */
export const groupByProject = (tickets: TicketWithProject[]): ProjectGroup[] => {
	const byProject = new Map<string, TicketWithProject[]>();
	for (const ticket of tickets) {
		const bucket = byProject.get(ticket.project) ?? [];
		bucket.push(ticket);
		byProject.set(ticket.project, bucket);
	}
	return [...byProject.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([project, list]) => ({
			project,
			tickets: list.sort((first, second) => second.id.localeCompare(first.id)),
		}));
};

/** Flatten groups into a render list of header + ticket rows for keyboard navigation. */
export type ListRow =
	| { kind: 'header'; project: string; count: number }
	| { kind: 'ticket'; ticket: TicketWithProject };

export const buildRows = (groups: ProjectGroup[]): ListRow[] => {
	const rows: ListRow[] = [];
	for (const group of groups) {
		rows.push({ kind: 'header', project: group.project, count: group.tickets.length });
		for (const ticket of group.tickets) rows.push({ kind: 'ticket', ticket });
	}
	return rows;
};
