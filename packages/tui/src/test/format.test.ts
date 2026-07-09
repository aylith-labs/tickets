import { describe, expect, test } from 'bun:test';
import type { TicketWithProject } from '@aylith/tickets-core';
import { buildRows, groupByProject, relativeTime, statusColor } from '../format';

const ticket = (project: string, id: string, status = 'todo'): TicketWithProject => ({
	project,
	id,
	title: `${project} ${id}`,
	status,
	archived: false,
	created: '2026-07-09T00:00:00.000Z',
	attachments: [],
	description: '',
});

describe('groupByProject / buildRows', () => {
	test('groups by project (alphabetical), ids descending, with header rows', () => {
		const groups = groupByProject([ticket('zeta', '0001'), ticket('alpha', '0002'), ticket('alpha', '0005')]);
		expect(groups.map((group) => group.project)).toEqual(['alpha', 'zeta']);
		expect(groups[0]?.tickets.map((entry) => entry.id)).toEqual(['0005', '0002']);

		const rows = buildRows(groups);
		expect(rows[0]).toEqual({ kind: 'header', project: 'alpha', count: 2 });
		expect(rows[1]).toMatchObject({ kind: 'ticket' });
		expect(rows.filter((row) => row.kind === 'header').length).toBe(2);
		expect(rows.filter((row) => row.kind === 'ticket').length).toBe(3);
	});
});

describe('statusColor', () => {
	test('maps known statuses', () => {
		expect(statusColor('todo')).toBe('gray');
		expect(statusColor('in_progress')).toBe('blue');
		expect(statusColor('in_review')).toBe('yellow');
		expect(statusColor('done')).toBe('green');
		expect(statusColor('weird')).toBe('white');
	});
});

describe('relativeTime', () => {
	test('handles missing and invalid input', () => {
		expect(relativeTime(undefined)).toBe('—');
		expect(relativeTime('not-a-date')).toBe('—');
	});
});
