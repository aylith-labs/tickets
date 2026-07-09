import { spawn } from 'node:child_process';
import type { Ticket } from '@aylith/tickets-core';

/** Fire-and-forget shell hook on status changes; failures only warn. */
export const runStatusChangeHook = (
	command: string | undefined,
	projectName: string,
	ticket: Ticket,
	oldStatus: string,
	newStatus: string,
): void => {
	if (!command) return;
	const child = spawn('sh', ['-c', command], {
		env: {
			...process.env,
			PROJECT: projectName,
			TICKET_ID: ticket.id,
			TICKET_TITLE: ticket.title,
			OLD_STATUS: oldStatus,
			NEW_STATUS: newStatus,
		},
		stdio: 'ignore',
		detached: true,
	});
	child.on('error', (error) => console.warn('tickets: onStatusChange hook failed:', error.message));
	child.unref();
};
