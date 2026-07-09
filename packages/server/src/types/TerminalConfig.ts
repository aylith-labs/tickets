export type TerminalConfig = {
	id: string;
	label: string;
	/**
	 * Shell command run on the daemon host to open a terminal working the ticket.
	 * Placeholders: $REPO (project repo path), $PROMPT_URL (ticket prompt endpoint),
	 * plus anything the host shell resolves itself (e.g. $WSL_DISTRO_NAME).
	 */
	command: string;
};
