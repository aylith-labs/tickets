import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { composePrompt } from '../packages/core/src/prompt';

const root = import.meta.dir,
	output = resolve(root, 'build');
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'home'), { recursive: true });
const prompt = composePrompt(
	{
		id: 'example-17',
		title: 'Keep search within reach on a small screen',
		description:
			'The filters push the search field off screen. Keep the query visible while browsing results.\n\nAcceptance criteria:\n- Search stays visible at narrow widths.\n- Keyboard users can reach every filter.\n- Before and after evidence accompanies the fix.',
		status: 'in_progress',
		archived: false,
		created: '2026-01-01T00:00:00Z',
		attachments: [],
	},
	{ id: 'example-project', name: 'Example project', repoPath: '/your/project' },
	{ apiBase: 'http://127.0.0.1:6320/api' },
);
const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace('@@PROMPT@@', escapeHtml(prompt));
await writeFile(resolve(output, 'index.html'), html);
await writeFile(resolve(output, 'home/index.html'), html);
for (const file of ['site.css', 'site.js']) await copyFile(resolve(root, file), resolve(output, file));
await writeFile(resolve(output, 'CNAME'), 'tickets.aylith.com\n');
await writeFile(
	resolve(output, 'robots.txt'),
	'User-agent: *\nAllow: /\nSitemap: https://tickets.aylith.com/sitemap.xml\n',
);
await writeFile(
	resolve(output, 'sitemap.xml'),
	'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://tickets.aylith.com/home/</loc></url></urlset>\n',
);
await writeFile(resolve(output, 'example-prompt.txt'), `${prompt}\n`);
await writeFile(resolve(output, '.nojekyll'), '');
console.log(
	JSON.stringify({
		output,
		pages: 2,
		canonical: 'https://tickets.aylith.com/home/',
		promptSource: 'packages/core/src/prompt.ts',
		publicRelease: 'v0.1.4',
	}),
);
