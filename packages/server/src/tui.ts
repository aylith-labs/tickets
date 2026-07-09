import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Launch the terminal UI. Resolution order:
 *  1. a `tickets-tui` binary next to this executable (standalone-binary distribution),
 *  2. `tickets-tui` on PATH (npm install),
 *  3. `bun` on the workspace tui entry (running from source).
 */
export const runTui = (args: string[]): void => {
	const exeDir = dirname(process.execPath);
	const siblingBin = join(exeDir, process.platform === 'win32' ? 'tickets-tui.exe' : 'tickets-tui');
	const sourceEntry = fileURLToPath(new URL('../../tui/src/index.tsx', import.meta.url));

	let command: string;
	let commandArgs: string[];
	if (existsSync(siblingBin)) {
		command = siblingBin;
		commandArgs = args;
	} else if (existsSync(sourceEntry)) {
		command = 'bun';
		commandArgs = [sourceEntry, ...args];
	} else {
		command = 'tickets-tui';
		commandArgs = args;
	}

	const child = spawn(command, commandArgs, { stdio: 'inherit' });
	child.on('error', (error) => {
		console.error(`Could not launch the tickets TUI (${command}): ${error.message}`);
		console.error('Install it with: npm i -g @aylith/tickets-tui  (or run tickets-tui directly)');
		process.exit(1);
	});
	child.on('exit', (code) => process.exit(code ?? 0));
};
