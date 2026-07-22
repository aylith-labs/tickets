/**
 * Self-describing store metadata written at `<dataDir>/.tickets-store.json`.
 * For a git store it is committed on the data branch so `id` survives reclone.
 */
export type StoreMarker = {
	schemaVersion: 1;
	/** Immutable durable project identity. */
	id: string;
	/** Display name at last write; refreshed by `tickets rename`. */
	name: string;
	kind: 'git' | 'folder';
	/** git only: origin URL captured at init — disambiguates stores on reclone. */
	repoRemote?: string;
	createdAt: string;
};
