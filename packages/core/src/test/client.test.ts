import { afterEach, describe, expect, test } from 'bun:test';
import { TicketsClient } from '../client';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const meta = { projects: [], statuses: [], terminals: [], enrichProviders: [], apiBase: '/api', storeRoots: {} };

/** `fetch` carries a `preconnect` member, so a bare function is not a drop-in replacement. */
const stubFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch =>
	Object.assign(handler, { preconnect: originalFetch.preconnect });

const metaResponse = (): Response =>
	new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } });

test('ticket actions encode stable keys and revision references as path segments', async () => {
	const paths: string[] = [];
	globalThis.fetch = stubFetch(async (input) => {
		paths.push(String(input));
		return Response.json({ revisions: [] });
	});
	const client = new TicketsClient('http://localhost/api');
	const project = 'stable ?#';
	const id = '0001';
	const ref = 'branch/ref ?#';
	await client.patch(project, id, { status: 'done' });
	await client.archive(project, id);
	await client.prompt(project, id);
	await client.launch(project, id, 'fixture');
	await client.enrich(project, id);
	await client.revisions(project, id);
	await client.revision(project, id, ref);
	await client.restore(project, id, ref);
	await client.attach(project, id, new File(['fixture'], 'fixture.txt'), 'other');
	const base = 'http://localhost/api/tickets/stable%20%3F%23/0001';
	expect(paths).toEqual([
		base,
		`${base}/archive`,
		`${base}/prompt`,
		`${base}/launch`,
		`${base}/enrich`,
		`${base}/revisions`,
		`${base}/revisions/branch%2Fref%20%3F%23`,
		`${base}/revisions/branch%2Fref%20%3F%23/restore`,
		`${base}/attachments`,
	]);
});

describe('TicketsClient.meta', () => {
	test('a failed lookup stays retryable', async () => {
		let calls = 0;
		globalThis.fetch = stubFetch(async () => {
			calls = calls + 1;
			if (calls === 1) throw new Error('network down');
			return metaResponse();
		});

		const client = new TicketsClient('http://localhost/api');
		await expect(client.meta()).rejects.toThrow('network down');
		expect(await client.meta()).toMatchObject({ apiBase: '/api' });
		expect(calls).toBe(2);
	});

	test('a successful lookup is fetched once', async () => {
		let calls = 0;
		globalThis.fetch = stubFetch(async () => {
			calls = calls + 1;
			return metaResponse();
		});

		const client = new TicketsClient('http://localhost/api');
		await client.meta();
		await client.meta();
		expect(calls).toBe(1);
	});
});
