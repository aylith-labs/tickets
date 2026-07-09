import { defineConfig } from 'tsup';

// Umbrella re-export stubs. Declarations via `tsc --emitDeclarationOnly`
// (build script) — tsup's rollup-plugin-dts is incompatible with TypeScript 7.
export default defineConfig({
	entry: ['src/index.ts', 'src/client.ts', 'src/ui.ts', 'src/server.ts'],
	format: ['esm'],
	dts: false,
	sourcemap: true,
	clean: true,
	minify: false,
	external: ['@aylith/tickets-core', '@aylith/tickets-server', '@aylith/tickets-tui', '@aylith/tickets-ui'],
});
