import { spawn } from 'node:child_process';
import clipboardy from 'clipboardy';

export const clipboardHint = (): string => (process.env.WSL_DISTRO_NAME ? '(Windows clipboard)' : '');

/**
 * Copy text to the clipboard. Under WSL, route through clip.exe so it lands on
 * the Windows clipboard (clipboardy's Linux backends don't reach it); otherwise
 * use clipboardy.
 */
export const copyToClipboard = async (text: string): Promise<void> => {
	if (process.env.WSL_DISTRO_NAME) {
		await new Promise<void>((resolve, reject) => {
			const child = spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'] });
			child.on('error', reject);
			child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`clip.exe exited ${code}`))));
			child.stdin.end(text);
		});
		return;
	}
	await clipboardy.write(text);
};
