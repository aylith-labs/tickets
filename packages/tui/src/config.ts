import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATH = join(homedir(), '.config', 'aylith-tickets', 'config.json');
const DEFAULT_PORT = 6320;

/**
 * Resolve the daemon API base. Priority: --api-base flag > TICKETS_API_BASE env
 * > localhost on the configured port > localhost on the default port. The TUI
 * runs on the same host as the daemon, so it hits localhost directly (no proxy).
 */
export const resolveApiBase = (flag?: string): string => {
	if (flag) return flag.replace(/\/$/, '');
	if (process.env.TICKETS_API_BASE) return process.env.TICKETS_API_BASE.replace(/\/$/, '');
	let port = DEFAULT_PORT;
	try {
		const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { port?: number };
		if (typeof config.port === 'number') port = config.port;
	} catch {
		// no config yet — fall back to the default port
	}
	return `http://localhost:${port}/api`;
};
