import { describe, expect, test } from 'bun:test';
import { composePrompt } from '../prompt';
import type { Ticket } from '../types/Ticket';

const ticket: Ticket = {
	id: '0042',
	title: 'Add dark mode toggle',
	status: 'todo',
	archived: false,
	created: '2026-07-09T14:03:00.000Z',
	attachments: [],
	description: 'The settings page needs a dark mode toggle.',
};

describe('composePrompt', () => {
	test('fills every placeholder of the default template', () => {
		const prompt = composePrompt(
			ticket,
			{ name: 'demo-app', repoPath: '/home/user/projects/demo-app' },
			{ apiBase: 'https://tickets.lvh.me/api/' },
		);
		expect(prompt).toContain('ticket 0042');
		expect(prompt).toContain('"demo-app"');
		expect(prompt).toContain('Repository: /home/user/projects/demo-app');
		expect(prompt).toContain('# Add dark mode toggle');
		expect(prompt).toContain('The settings page needs a dark mode toggle.');
		expect(prompt).toContain('https://tickets.lvh.me/api/tickets/demo-app/0042/attachments');
		expect(prompt).not.toContain('$TICKET');
		expect(prompt).not.toContain('$REPO');
	});

	test('supports custom templates', () => {
		const prompt = composePrompt(
			ticket,
			{ name: 'demo', repoPath: '/tmp/demo' },
			{ apiBase: 'http://localhost:1234/api', template: 'cd $REPO && work on $TICKET_TITLE ($TICKET_API)' },
		);
		expect(prompt).toBe('cd /tmp/demo && work on Add dark mode toggle (http://localhost:1234/api/tickets/demo/0042)');
	});

	test('substitutes a placeholder body when the description is empty', () => {
		const prompt = composePrompt(
			{ ...ticket, description: '' },
			{ name: 'demo', repoPath: '/tmp/demo' },
			{ apiBase: 'http://localhost:1234/api' },
		);
		expect(prompt).toContain('(no description)');
	});
});
