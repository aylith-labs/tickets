import type { EnrichProviderConfig } from './EnrichProviderConfig';
import type { MediaConfig } from './MediaConfig';
import type { ProjectEntry } from './ProjectEntry';
import type { TerminalConfig } from './TerminalConfig';

export type DaemonConfig = {
	port: number;
	/** Public API base used in composed prompts and $PROMPT_URL, e.g. https://tickets.lvh.me/api */
	apiBase: string;
	statuses: string[];
	projects: ProjectEntry[];
	terminals: TerminalConfig[];
	enrich: {
		defaultProvider: string;
		providers: EnrichProviderConfig[];
	};
	media?: MediaConfig;
	/** Optional override of the built-in agent prompt template. */
	promptTemplate?: string;
	/** Optional shell command run on any status change (env: PROJECT, TICKET_ID, TICKET_TITLE, OLD_STATUS, NEW_STATUS). */
	onStatusChange?: string;
};
