import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import { TicketsApp } from '../TicketsApp';

const META = {
	projects: [
		{
			name: 'linux-settings',
			repoPath: '/repo',
			adapter: 'git',
			location: {
				kind: 'git',
				scope: 'central',
				dataDir: '/store/linux-settings-ab12cd',
				branch: 'main',
				pushEnabled: true,
			},
		},
	],
	statuses: ['todo', 'in_progress', 'in_review', 'done'],
	terminals: [{ id: 'wt', label: 'Windows Terminal' }],
	enrichProviders: ['claude-cli'],
	apiBase: 'http://test/api',
	storeRoots: { store: '/store', worktrees: '/worktrees' },
};

const TICKETS = {
	tickets: [
		{
			project: 'linux-settings',
			id: '0001',
			title: 'Surface backup age on the overview card',
			status: 'todo',
			archived: false,
			created: '2026-07-09T00:00:00.000Z',
			attachments: [],
			description: 'The dashboard shows the last backup time but not how stale it is.',
		},
	],
};

const originalFetch = globalThis.fetch;
const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;

beforeEach(() => {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input.toString();
		const body = url.includes('/projects') ? META : TICKETS;
		return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
	}) as typeof fetch;
	(globalThis as { EventSource?: unknown }).EventSource = class {
		addEventListener() {}
		close() {}
	};
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	(globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
});

const waitForFrame = async (lastFrame: () => string | undefined, needle: string, timeoutMs = 2000): Promise<string> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const frame = lastFrame() ?? '';
		if (frame.includes(needle)) return frame;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return lastFrame() ?? '';
};

describe('TicketsApp render', () => {
	test('renders the header, project group, and the ticket from the daemon', async () => {
		const { lastFrame, unmount } = render(<TicketsApp apiBase="http://test/api" />);
		const frame = await waitForFrame(lastFrame, '#0001');
		expect(frame).toContain('tickets');
		expect(frame).toContain('all projects');
		expect(frame).toContain('linux-settings');
		// the selected ticket's storage location is surfaced
		expect(frame).toContain('git/central');
		expect(frame).toContain('#0001');
		expect(frame).toContain('Surface backup age');
		// preview pane shows the description
		expect(frame).toContain('last backup time');
		// command bar hint
		expect(frame).toContain('enter launch');
		unmount();
	});

	test('filter narrows the list', async () => {
		const { lastFrame, stdin, unmount } = render(<TicketsApp apiBase="http://test/api" />);
		await waitForFrame(lastFrame, '#0001');
		stdin.write('/'); // enter filter mode
		await new Promise((resolve) => setTimeout(resolve, 50));
		stdin.write('zzznomatch');
		const frame = await waitForFrame(lastFrame, 'No tickets', 1500);
		expect(frame).toContain('No tickets');
		unmount();
	});
});
