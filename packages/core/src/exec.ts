import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ExecResult = { stdout: string; stderr: string };

export const exec = async (command: string, args: string[], cwd: string): Promise<ExecResult> => {
	const { stdout, stderr } = await execFileAsync(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
	return { stdout, stderr };
};
