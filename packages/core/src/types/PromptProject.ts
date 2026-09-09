export type PromptProject = {
	/** Stable project identity for source URLs; display name is presentation only. */
	id?: string;
	name: string;
	/** Absolute path of the repository the ticket is about. */
	repoPath: string;
};
