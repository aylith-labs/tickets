import { resolve } from 'node:path';
// Match the original regression tests' runner; no parent package/source changes.
import { defineConfig } from '../../../../aylith-shell/node_modules/@playwright/test';

export default defineConfig({
	testDir: '../../../scripts',
	testMatch: 'identity.browser.ts',
	workers: 1,
	timeout: 15_000,
	outputDir: './artifacts-identity',
	reporter: [['list'], ['html', { outputFolder: resolve(import.meta.dirname, 'report-identity'), open: 'never' }]],
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
		env: { TICKETS_SHELL_ENABLED: '0' },
	},
});
