import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { type Attachment, type AttachmentKind, type AttachmentType, exec } from '@aylith/tickets-core';
import type { MediaConfig } from './types/MediaConfig';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4', '.mov', '.mkv']);

export const attachmentTypeForFilename = (filename: string): AttachmentType | null => {
	const extension = extname(filename).toLowerCase();
	if (IMAGE_EXTENSIONS.has(extension)) return 'image';
	if (VIDEO_EXTENSIONS.has(extension)) return 'video';
	return null;
};

const sanitizeFilename = (filename: string): string => {
	const base = basename(filename);
	return base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
};

const isAlreadyExists = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';

/**
 * Media paths are immutable on the CDN — never overwrite, pick a fresh name.
 * The exclusive write is what claims the name: testing first and writing after
 * lets two concurrent uploads settle on the same candidate.
 */
const writeUnique = async (directory: string, filename: string, data: Uint8Array): Promise<string> => {
	const extension = extname(filename);
	const stem = filename.slice(0, filename.length - extension.length);
	let candidate = filename;
	let counter = 2;
	for (;;) {
		try {
			await writeFile(join(directory, candidate), data, { flag: 'wx' });
			return candidate;
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			candidate = `${stem}-${counter}${extension}`;
			counter = counter + 1;
		}
	}
};

export type PublishInput = {
	media: MediaConfig;
	projectName: string;
	ticketId: string;
	filename: string;
	kind: AttachmentKind;
	label?: string;
	data: Uint8Array;
};

/**
 * Copies the upload into the media repo, commits, then best-effort push +
 * publish command (e.g. ./sync.sh push). CI on the media repo is the safety
 * net when the local publish fails.
 */
export const publishAttachment = async (input: PublishInput): Promise<Attachment> => {
	const type = attachmentTypeForFilename(input.filename);
	if (!type) throw new Error(`Unsupported media file type: ${input.filename}`);

	const relativeDir = join('media', input.media.pathPrefix, input.projectName, input.ticketId);
	const absoluteDir = join(input.media.repoPath, relativeDir);
	await mkdir(absoluteDir, { recursive: true });
	const name = await writeUnique(absoluteDir, sanitizeFilename(input.filename), input.data);

	const relativeFile = join(relativeDir, name);
	await exec('git', ['add', '--', relativeFile], input.media.repoPath);
	await exec(
		'git',
		[
			'commit',
			'--no-verify',
			'-m',
			`Add ${input.projectName} ticket ${input.ticketId} ${input.kind} media`,
			'--',
			relativeFile,
		],
		input.media.repoPath,
	);

	try {
		await exec('git', ['push', '--no-verify'], input.media.repoPath);
	} catch (error) {
		console.warn('tickets: media repo push failed:', error instanceof Error ? error.message : error);
	}
	if (input.media.publishCommand) {
		try {
			await exec('sh', ['-c', input.media.publishCommand], input.media.repoPath);
		} catch (error) {
			console.warn('tickets: media publish command failed:', error instanceof Error ? error.message : error);
		}
	}

	const baseUrl = input.media.baseUrl.replace(/\/$/, '');
	const urlPath = [input.media.pathPrefix, input.projectName, input.ticketId, name].join('/');
	const attachment: Attachment = { url: `${baseUrl}/${urlPath}`, kind: input.kind, type };
	if (input.label) attachment.label = input.label;
	return attachment;
};
