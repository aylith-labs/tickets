import type { StoreLocation } from '@aylith/tickets-core';
import type { AdapterKind } from './AdapterKind';

export type ProjectEntry = {
	/** Immutable identity; minted on init (new) or first daemon run (legacy). Optional at rest. */
	id?: string;
	name: string;
	/** Absolute path of the project repository. */
	repoPath: string;
	/** Canonical storage descriptor. Absent only on legacy configs (upgraded on read). */
	location?: StoreLocation;
	/** Set by reconcile when the store can't be found; surfaced in /api/projects. */
	unavailable?: string;
	/** @deprecated legacy — upgraded into `location` by `withDefaults` on read. */
	adapter?: AdapterKind;
	/** @deprecated legacy — upgraded into `location` by `withDefaults` on read. */
	dataDir?: string;
};
