import type { TicketWithProject } from '@aylith/tickets-core';
import { Box, Text } from 'ink';
import { relativeTime, statusColor } from './format';

type Props = {
	ticket?: TicketWithProject;
	width: number;
	height: number;
};

export function TicketPreview({ ticket, width, height }: Props) {
	if (!ticket) {
		return (
			<Box width={width} height={height} paddingX={1}>
				<Text dimColor>Select a ticket.</Text>
			</Box>
		);
	}

	const bodyLines = ticket.description.split('\n');
	const maxBody = Math.max(0, height - 7);
	const shown = bodyLines.slice(0, maxBody);
	const before = ticket.attachments.filter((attachment) => attachment.kind === 'before').length;
	const after = ticket.attachments.filter((attachment) => attachment.kind === 'after').length;

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			<Text wrap="truncate">
				<Text dimColor>
					{ticket.project} / #{ticket.id}
				</Text>{' '}
				<Text color={statusColor(ticket.status)}>{ticket.status.replace(/_/g, ' ')}</Text>
			</Text>
			<Text bold wrap="wrap">
				{ticket.title}
			</Text>
			<Box marginTop={1} flexDirection="column">
				{shown.length === 0 || (shown.length === 1 && shown[0] === '') ? (
					<Text dimColor>No description.</Text>
				) : (
					<Text wrap="wrap">{shown.join('\n')}</Text>
				)}
				{bodyLines.length > maxBody ? <Text dimColor>… {bodyLines.length - maxBody} more lines</Text> : null}
			</Box>
			<Box marginTop={1}>
				<Text dimColor>
					updated {relativeTime(ticket.updated ?? ticket.created)}
					{ticket.attachments.length > 0 ? `  ·  media: ${before} before / ${after} after` : ''}
				</Text>
			</Box>
		</Box>
	);
}
