import { expect, test } from 'bun:test';
import type { TicketWithProject } from '../../../packages/core/src/client';
import { linkedTicket, ticketProjectKey } from '../../../packages/ui/src/ticket-selection';
import { readTicketRoute } from './ticket-route';

const ticket = (projectId?: string): TicketWithProject => ({
	id: '0001',
	projectId,
	project: 'Same name',
	title: 'Linked item',
	description: '',
	status: 'todo',
	archived: false,
	attachments: [],
	created: '2026-09-08T00:00:00.000Z',
});
test('explicit numeric ticket query, absent query, unrelated query', () => {
	expect(readTicketRoute('?ticket=0001')).toEqual({ id: '0001' });
	expect(readTicketRoute('?view=board')).toEqual({});
});
for (const value of [
	'?ticket=',
	'?ticket=..',
	'?ticket=%2f1',
	'?ticket=0001&ticket=0002',
	'?ticket=1x',
	'?ticket=12345678901234567',
]) {
	test(`invalid deep link ${value}`, () => expect(readTicketRoute(value).error).toBe('Invalid ticket URL'));
}
test('stable project ID precedes colliding display names; no first match fallback', () => {
	const a = ticket('a'),
		b = ticket('b');
	expect(linkedTicket([b, a], 'a', '0001')).toBe(a);
	expect(linkedTicket([b, a], 'Same name', '0001')).toBeUndefined();
	expect(linkedTicket([a, a], 'a', '0001')).toBeUndefined();
	expect(linkedTicket([ticket()], 'Same name', '0001')).toBeUndefined();
	expect(linkedTicket([a], 'a', '0002')).toBeUndefined();
	expect(ticketProjectKey(a)).toBe('a');
	expect(ticketProjectKey(ticket())).toBe('Same name');
});
