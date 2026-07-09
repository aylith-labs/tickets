import { describe, expect, test } from 'bun:test';
import { parseTicket, serializeTicket } from '../markdown';
import type { Ticket } from '../types/Ticket';

const sample: Ticket = {
	id: '0007',
	title: 'Fix explorer hovercard clipping',
	status: 'todo',
	archived: false,
	created: '2026-07-09T14:03:00.000Z',
	updated: '2026-07-09T15:00:00.000Z',
	attachments: [
		{ url: 'https://media.example.com/tickets/demo/0007/before.webm', kind: 'before', type: 'video' },
		{ url: 'https://media.example.com/tickets/demo/0007/after.png', kind: 'after', type: 'image', label: 'Fixed' },
	],
	description: 'The hovercard clips at the viewport edge.\n\nSteps:\n1. Hover a long filename.',
};

describe('markdown', () => {
	test('roundtrips a full ticket', () => {
		const parsed = parseTicket(serializeTicket(sample));
		expect(parsed).toEqual(sample);
	});

	test('roundtrips a minimal ticket', () => {
		const minimal: Ticket = {
			id: '0001',
			title: 'Minimal',
			status: 'todo',
			archived: false,
			created: '2026-07-09T14:03:00.000Z',
			attachments: [],
			description: '',
		};
		const parsed = parseTicket(serializeTicket(minimal));
		expect(parsed).toEqual(minimal);
	});

	test('parses yaml Date values back to ISO strings', () => {
		const raw = [
			'---',
			'id: "0002"',
			'title: Dates',
			'status: todo',
			'archived: false',
			'created: 2026-07-09T14:03:00.000Z',
			'---',
			'Body.',
			'',
		].join('\n');
		const parsed = parseTicket(raw);
		expect(parsed.created).toBe('2026-07-09T14:03:00.000Z');
	});

	test('drops malformed attachments and defaults kind/type', () => {
		const raw = [
			'---',
			'id: "0003"',
			'title: Attachments',
			'status: todo',
			'archived: false',
			'created: 2026-07-09T14:03:00.000Z',
			'attachments:',
			'  - url: https://example.com/shot.png',
			'  - nonsense: true',
			'---',
			'',
		].join('\n');
		const parsed = parseTicket(raw);
		expect(parsed.attachments).toEqual([{ url: 'https://example.com/shot.png', kind: 'other', type: 'image' }]);
	});
});
