import { defineConfig } from 'tsup';

// Declarations via `tsc --emitDeclarationOnly` (build script) — tsup's
// rollup-plugin-dts is incompatible with TypeScript 7.
export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: false,
	sourcemap: true,
	clean: true,
	minify: false,
	external: ['lit', '@aylith/tickets-core'],
});
