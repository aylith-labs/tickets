import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Do not publish a daemon that works only inside the source checkout.
export async function checkWebPackage(directory: string): Promise<void> {
	for (const name of ['index.html', 'main.js', 'components.js']) {
		const info = await stat(join(directory, name)).catch(() => null);
		if (!info?.isFile() || info.size === 0) {
			throw new Error(`Missing packaged browser asset ${name}. Run bun run build before packing.`);
		}
	}
}
if (import.meta.main) {
	await checkWebPackage(fileURLToPath(new URL('../packages/server/dist/web', import.meta.url)));
	console.log('Packaged Tickets browser assets are present');
}
