import type { PromptProject } from './types/PromptProject';
import type { Ticket } from './types/Ticket';

export type PromptOptions = {
	/** Public API base, e.g. https://tickets.lvh.me/api */
	apiBase: string;
	/** Override the default template; same placeholders. */
	template?: string;
};

export const DEFAULT_PROMPT_TEMPLATE = `Work on ticket $TICKET_ID for project "$PROJECT_NAME".

Repository: $REPO

# $TICKET_TITLE

$TICKET_DESCRIPTION

# Working agreement

- Work inside $REPO.
- The ticket is tracked at $TICKET_API (no auth). It is already in_progress.
- Before changing code, capture BEFORE evidence of the current behavior (screenshot or screen recording). After verifying your fix, capture AFTER evidence.
- Upload each piece of evidence:
  curl -sS -F "file=@/path/to/capture.png" -F "kind=before" "$TICKET_API/attachments"
  curl -sS -F "file=@/path/to/capture.webm" -F "kind=after" "$TICKET_API/attachments"
- When the work is complete, verified, and evidence is attached, transition the ticket:
  curl -sS -X PATCH "$TICKET_API" -H "content-type: application/json" -d '{"status":"in_review"}'
- If you are blocked, leave the status as in_progress and explain the blocker in your final message.`;

const applyPlaceholders = (template: string, values: Record<string, string>): string => {
	// Longest keys first so $TICKET_API never partially matches inside $TICKET_API/attachments etc.
	const keys = Object.keys(values).sort((first, second) => second.length - first.length);
	let output = template;
	for (const key of keys) {
		output = output.split(key).join(values[key] ?? '');
	}
	return output;
};

export const composePrompt = (ticket: Ticket, project: PromptProject, options: PromptOptions): string => {
	const apiBase = options.apiBase.replace(/\/$/, '');
	const values: Record<string, string> = {
		$TICKET_API: `${apiBase}/tickets/${project.name}/${ticket.id}`,
		$TICKET_ID: ticket.id,
		$TICKET_TITLE: ticket.title,
		$TICKET_DESCRIPTION: ticket.description.length > 0 ? ticket.description : '(no description)',
		$PROJECT_NAME: project.name,
		$API_BASE: apiBase,
		$REPO: project.repoPath,
	};
	return applyPlaceholders(options.template ?? DEFAULT_PROMPT_TEMPLATE, values);
};
