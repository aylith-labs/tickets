import { spawn } from 'node:child_process';

export type LaunchValues = {
	/** Absolute path of the project repository. */
	repoPath: string;
	/** URL of the ticket's plain-text prompt endpoint. */
	promptUrl: string;
};

/**
 * Substitutes $REPO and $PROMPT_URL. Anything else (e.g. $WSL_DISTRO_NAME,
 * %LOCALAPPDATA%) is left for the host shell to resolve.
 */
export const buildLaunchCommand = (template: string, values: LaunchValues): string =>
	template.split('$PROMPT_URL').join(values.promptUrl).split('$REPO').join(values.repoPath);

/** Detached fire-and-forget shell execution on the daemon host. */
export const runDetached = (command: string): void => {
	const child = spawn('sh', ['-c', command], { stdio: 'ignore', detached: true });
	child.on('error', (error) => console.warn('tickets: launch failed:', error.message));
	child.unref();
};
