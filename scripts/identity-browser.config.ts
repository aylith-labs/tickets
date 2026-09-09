import { resolve } from 'node:path';
import { defineConfig } from '../../aylith-shell/node_modules/@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'identity.browser.ts',
	workers: 1,
	timeout: 15000,
	use: {
		baseURL: 'http://127.0.0.1:57610',
		viewport: { width: 1440, height: 900 },
		video: 'on',
		screenshot: 'on',
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'bun run scripts/identity-browser-server.ts',
		cwd: resolve(__dirname, '..'),
		url: 'http://127.0.0.1:57610/api/projects',
		reuseExistingServer: false,
	},
});
