import type { AdapterKind } from './AdapterKind';

export type ProjectEntry = {
	name: string;
	/** Absolute path of the project repository. */
	repoPath: string;
	adapter: AdapterKind;
	/** Directory holding the `tickets/` folder (the data-branch worktree for the git adapter). */
	dataDir: string;
};
