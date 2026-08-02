import { afterEach, describe, expect, test } from 'bun:test';
import { TicketsClient } from '../client';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const meta = { projects: [], statuses: [], terminals: [], enrichProviders: [], apiBase: '/api', storeRoots: {} };

/** `fetch` carries a `preconnect` member, so a bare function is not a drop-in replacement. */
const stubFetch = (handler: () => Promise<Response>): typeof fetch =>
	Object.assign(handler, { preconnect: originalFetch.preconnect });

const metaResponse = (): Response =>
	new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } });

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
