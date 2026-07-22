export type StoreScope = 'repo' | 'central';

/**
 * Self-describing storage location. `dataDir` is the absolute directory that
 * directly contains the `tickets/` folder (same meaning as
 * `FolderAdapterOptions.dataDir`). `remote`/`branch`/`pushEnabled` are
 * meaningful only when `kind === 'git'`.
 */
export type StoreLocation = {
	kind: 'git' | 'folder';
	scope: StoreScope;
	dataDir: string;
	/** git only: origin URL, if configured. */
	remote?: string;
	/** git only: branch the ticket data lives on ('tickets' per-repo, 'main' central). */
	branch?: string;
	/** git only: push after each mutation (default true). */
	pushEnabled?: boolean;
};
