import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STATUSES, exec } from '@aylith/tickets-core';
import type { Hono } from 'hono';
import { createApp } from '../app';
import { createContext } from '../context';
import { attachmentTypeForFilename, publishAttachment } from '../media';
import { DEFAULT_TERMINALS } from '../registry';
import type { DaemonConfig } from '../types/DaemonConfig';
import type { MediaConfig } from '../types/MediaConfig';

describe('attachmentTypeForFilename', () => {
	test('classifies images, videos, and rejects the rest', () => {
		expect(attachmentTypeForFilename('shot.PNG')).toBe('image');
		expect(attachmentTypeForFilename('clip.webm')).toBe('video');
		expect(attachmentTypeForFilename('notes.txt')).toBeNull();
	});
});

describe('publishAttachment', () => {
	let mediaRepo: string;
	let media: MediaConfig;

	beforeEach(async () => {
		mediaRepo = await mkdtemp(join(tmpdir(), 'tickets-media-repo-'));
		await exec('git', ['init', '-b', 'main'], mediaRepo);
		await exec('git', ['config', 'user.email', 'tickets@test.local'], mediaRepo);
		await exec('git', ['config', 'user.name', 'Tickets Test'], mediaRepo);
		media = { repoPath: mediaRepo, baseUrl: 'https://media.example.com', pathPrefix: 'tickets' };
	});

	afterEach(async () => {
		await rm(mediaRepo, { recursive: true, force: true });
	});

	test('writes, commits, and returns the public URL', async () => {
		const attachment = await publishAttachment({
			media,
			projectName: 'demo',
			ticketId: '0001',
			filename: 'before shot!.png',
			kind: 'before',
			data: new Uint8Array([1, 2, 3]),
		});
		expect(attachment.url).toBe('https://media.example.com/tickets/demo/0001/before-shot-.png');
		expect(attachment.type).toBe('image');

		const written = await readFile(join(mediaRepo, 'media/tickets/demo/0001/before-shot-.png'));
		expect([...written]).toEqual([1, 2, 3]);

		const { stdout } = await exec('git', ['log', '--format=%s'], mediaRepo);
		expect(stdout).toContain('Add demo ticket 0001 before media');
	});

	test('never overwrites — same name gets a numbered sibling', async () => {
		const input = {
			media,
			projectName: 'demo',
			ticketId: '0001',
			filename: 'after.png',
			kind: 'after' as const,
			data: new Uint8Array([9]),
		};
		const first = await publishAttachment(input);
		const second = await publishAttachment(input);
		expect(first.url).toContain('/after.png');
		expect(second.url).toContain('/after-2.png');
	});

	test('rejects unsupported file types', async () => {
		expect(
			publishAttachment({
				media,
				projectName: 'demo',
				ticketId: '0001',
				filename: 'payload.exe',
				kind: 'other',
				data: new Uint8Array([0]),
			}),
		).rejects.toThrow('Unsupported media file type');
	});
});

describe('POST /api/tickets/:project/:id/attachments', () => {
	let dataDir: string;
	let app: Hono;

	const buildConfig = (withMedia: boolean): DaemonConfig => ({
		port: 0,
		apiBase: 'https://tickets.lvh.me/api',
		statuses: [...DEFAULT_STATUSES],
		projects: [{ name: 'demo', repoPath: '/tmp/repos/demo', adapter: 'folder', dataDir }],
		terminals: DEFAULT_TERMINALS,
		enrich: { defaultProvider: 'claude-cli', providers: [{ id: 'claude-cli', kind: 'claude-cli' }] },
		media: withMedia
			? { repoPath: '/tmp/media-repo', baseUrl: 'https://media.example.com', pathPrefix: 'tickets' }
			: undefined,
	});

	const uploadRequest = (kind: string): Request => {
		const form = new FormData();
		form.append('file', new File([new Uint8Array([1])], 'before.png', { type: 'image/png' }));
		form.append('kind', kind);
		form.append('label', 'Broken state');
		return new Request('http://localhost/api/tickets/demo/0001/attachments', { method: 'POST', body: form });
	};

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'tickets-attach-test-'));
		app = createApp(
			createContext(buildConfig(true), {
				publishMedia: async (input) => ({
					url: `https://media.example.com/${input.media.pathPrefix}/${input.projectName}/${input.ticketId}/${input.filename}`,
					kind: input.kind,
					type: 'image',
					label: input.label,
				}),
			}),
		);
		await app.request('/api/tickets', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: 'demo', title: 'Attach here' }),
		});
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	test('uploads and appends the attachment to the ticket frontmatter', async () => {
		const response = await app.request(uploadRequest('before'));
		expect(response.status).toBe(201);
		const payload = await response.json();
		expect(payload.attachment.url).toBe('https://media.example.com/tickets/demo/0001/before.png');
		expect(payload.attachments.length).toBe(1);
		expect(payload.attachments[0].kind).toBe('before');
		expect(payload.attachments[0].label).toBe('Broken state');

		const fetched = await (await app.request('/api/tickets/demo/0001')).json();
		expect(fetched.attachments.length).toBe(1);
	});

	test('unknown kinds fall back to other; missing file is a 400', async () => {
		const response = await app.request(uploadRequest('bogus'));
		expect((await response.json()).attachment.kind).toBe('other');

		const empty = new FormData();
		empty.append('kind', 'before');
		const missingFile = await app.request(
			new Request('http://localhost/api/tickets/demo/0001/attachments', { method: 'POST', body: empty }),
		);
		expect(missingFile.status).toBe(400);
	});

	test('unconfigured media is a 503', async () => {
		const bareApp = createApp(createContext(buildConfig(false)));
		await bareApp.request('/api/tickets', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ project: 'demo', title: 'No media' }),
		});
		const response = await bareApp.request(uploadRequest('before'));
		expect(response.status).toBe(503);
	});
});
