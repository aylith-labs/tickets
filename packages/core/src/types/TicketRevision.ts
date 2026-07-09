export type TicketRevision = {
	/** Adapter-specific revision reference (git commit sha for the git adapter). */
	ref: string;
	/** ISO 8601 timestamp of the revision. */
	at: string;
	message: string;
};
