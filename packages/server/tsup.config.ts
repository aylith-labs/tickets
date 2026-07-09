import { defineConfig } from 'tsup';

// Bun-runtime daemon + CLI. Declarations via `tsc --emitDeclarationOnly`
// (build script) — tsup's rollup-plugin-dts is incompatible with TypeScript 7.
export default defineConfig({
	entry: ['src/index.ts', 'src/cli.ts'],
	format: ['esm'],
	dts: false,
	sourcemap: true,
	clean: true,
	minify: false,
	external: ['@anthropic-ai/sdk', 'hono', '@aylith/tickets-core'],
});
