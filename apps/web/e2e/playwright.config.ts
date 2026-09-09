import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'shell.browser.ts',
	workers: 1,
	timeout: 30_000,
	outputDir: './artifacts',
	reporter: [['list'], ['html', { outputFolder: resolve(import.meta.dirname, 'report'), open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:5184',
		viewport: { width: 1440, height: 1000 },
		video: 'on',
		screenshot: 'on',
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'bun run apps/web/e2e/serve-shell.ts',
		cwd: resolve(import.meta.dirname, '../../..'),
		url: 'http://127.0.0.1:5184/api/projects',
		reuseExistingServer: false,
		env: { TICKETS_SHELL_ENABLED: '1' },
	},
});
