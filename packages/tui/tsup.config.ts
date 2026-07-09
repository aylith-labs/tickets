import { defineConfig } from 'tsup';

// Ink CLI binary. No dts (not a library). Shebang preserved from src/index.tsx.
export default defineConfig({
	entry: ['src/index.tsx'],
	format: ['esm'],
	dts: false,
	sourcemap: true,
	clean: true,
	minify: false,
	external: ['react', 'ink', '@inkjs/ui', 'fuzzysort', 'clipboardy', '@aylith/tickets-core'],
});
