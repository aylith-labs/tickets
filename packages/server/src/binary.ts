#!/usr/bin/env bun
// Standalone-binary entry (`bun build --compile`). Embeds the web UI assets so
// `tickets serve` serves the central UI with no files on disk. Requires
// apps/web/dist to exist at compile time (the release workflow builds it first).
// The tsup-built npm CLI uses cli.ts instead (on-disk assets), so esbuild never
// sees these Bun-only `with { type: 'file' }` imports.
import componentsJs from '../../../apps/web/dist/components.js' with { type: 'file' };
import indexHtml from '../../../apps/web/dist/index.html' with { type: 'file' };
import mainJs from '../../../apps/web/dist/main.js' with { type: 'file' };
import { runCli } from './cli-run';

await runCli(process.argv.slice(2), {
	webAssets: {
		'index.html': indexHtml,
		'main.js': mainJs,
		'components.js': componentsJs,
	},
});
