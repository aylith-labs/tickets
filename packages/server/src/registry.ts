import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_STATUSES, FolderAdapter, GitBranchAdapter, type StorageAdapter } from '@aylith/tickets-core';
import type { DaemonConfig } from './types/DaemonConfig';
import type { ProjectEntry } from './types/ProjectEntry';
import type { TerminalConfig } from './types/TerminalConfig';

export const CONFIG_PATH = join(homedir(), '.config', 'aylith-tickets', 'config.json');

export const DEFAULT_PORT = 6320;

export const DEFAULT_TERMINALS: TerminalConfig[] = [
	{
		id: 'wt',
		label: 'Windows Terminal',
		command:
			'wt.exe -w 0 nt wsl.exe -d "$WSL_DISTRO_NAME" --cd "$REPO" -- bash -lic \'claude --dangerously-skip-permissions "$(curl -fsS $PROMPT_URL)"; exec bash\'',
	},
	{
		id: 'tabby',
		label: 'Tabby',
		command:
			'cmd.exe /c start "" "%LOCALAPPDATA%\\Programs\\Tabby\\Tabby.exe" run -- wsl.exe -d "$WSL_DISTRO_NAME" --cd "$REPO" -- bash -lic \'claude --dangerously-skip-permissions "$(curl -fsS $PROMPT_URL)"; exec bash\'',
	},
];

export const expandHome = (path: string): string => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

const withDefaults = (partial: Partial<DaemonConfig>): DaemonConfig => ({
	port: partial.port ?? DEFAULT_PORT,
	apiBase: partial.apiBase ?? `http://localhost:${partial.port ?? DEFAULT_PORT}/api`,
	statuses: partial.statuses ?? [...DEFAULT_STATUSES],
	projects: (partial.projects ?? []).map((project) => ({
		...project,
		repoPath: expandHome(project.repoPath),
		dataDir: expandHome(project.dataDir),
	})),
	terminals: partial.terminals ?? DEFAULT_TERMINALS,
	enrich: partial.enrich ?? {
		defaultProvider: 'claude-cli',
		providers: [{ id: 'claude-cli', kind: 'claude-cli' }],
	},
	media: partial.media ? { ...partial.media, repoPath: expandHome(partial.media.repoPath) } : undefined,
	promptTemplate: partial.promptTemplate,
	onStatusChange: partial.onStatusChange,
});

export const readDaemonConfig = async (configPath: string = CONFIG_PATH): Promise<DaemonConfig> => {
	try {
		const raw = await readFile(configPath, 'utf8');
		return withDefaults(JSON.parse(raw) as Partial<DaemonConfig>);
	} catch {
		return withDefaults({});
	}
};

export const writeDaemonConfig = async (config: DaemonConfig, configPath: string = CONFIG_PATH): Promise<void> => {
	await mkdir(dirname(configPath), { recursive: true });
	const tmpPath = `${configPath}.tmp-${process.pid}`;
	await writeFile(tmpPath, `${JSON.stringify(config, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, configPath);
};

export const createAdapter = (project: ProjectEntry): StorageAdapter =>
	project.adapter === 'git'
		? new GitBranchAdapter({ dataDir: project.dataDir })
		: new FolderAdapter({ dataDir: project.dataDir });
