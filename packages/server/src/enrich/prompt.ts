import type { Ticket } from '@aylith/tickets-core';

export const ENRICH_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string', description: 'Improved ticket title: imperative, specific, under 80 characters' },
		description: { type: 'string', description: 'Improved ticket description as markdown' },
	},
	required: ['title', 'description'],
	additionalProperties: false,
} as const;

export const buildEnrichPrompt = (ticket: Ticket): string => `You improve issue-tracker tickets written in a hurry.

Rewrite the ticket below:
- Sharpen the title: imperative mood, specific, under 80 characters.
- Structure the description as markdown: a short context paragraph, expected behavior, and a checklist of acceptance criteria.
- Keep every stated fact. Fill obvious gaps conservatively; never invent requirements beyond a reasonable reading.
- Match the original language of the ticket.

Ticket title: ${ticket.title}

Ticket description:
${ticket.description.length > 0 ? ticket.description : '(empty)'}

Respond ONLY with a JSON object: {"title": "...", "description": "..."}`;
