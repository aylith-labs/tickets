import { defineConfig } from 'tsup';

// Declarations are emitted separately via `tsc --emitDeclarationOnly`
// (build script) — tsup's rollup-plugin-dts is incompatible with TypeScript 7.
export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: false,
	sourcemap: true,
	clean: true,
	minify: false,
});
