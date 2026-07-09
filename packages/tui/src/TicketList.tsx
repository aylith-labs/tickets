import { Box, Text } from 'ink';
import type { ListRow } from './format';
import { relativeTime, statusColor } from './format';

type Props = {
	rows: ListRow[];
	selectedIndex: number;
	height: number;
	width: number;
};

const STATUS_GLYPH: Record<string, string> = {
	todo: '○',
	in_progress: '◐',
	in_review: '◑',
	done: '●',
};

export function TicketList({ rows, selectedIndex, height, width }: Props) {
	if (rows.length === 0) {
		return (
			<Box height={height} paddingX={1}>
				<Text dimColor>No tickets. Create one at the web UI, or press ? for help.</Text>
			</Box>
		);
	}

	// Scroll window keeping the selected row visible.
	const half = Math.floor(height / 2);
	let start = Math.max(0, selectedIndex - half);
	start = Math.min(start, Math.max(0, rows.length - height));
	const visible = rows.slice(start, start + height);
	const titleWidth = Math.max(10, width - 16);

	return (
		<Box flexDirection="column" height={height}>
			{visible.map((row, offset) => {
				const index = start + offset;
				if (row.kind === 'header') {
					return (
						<Text key={`h-${row.project}`} bold color="magenta">
							{row.project} <Text dimColor>({row.count})</Text>
						</Text>
					);
				}
				const { ticket } = row;
				const selected = index === selectedIndex;
				const glyph = STATUS_GLYPH[ticket.status] ?? '·';
				const title = ticket.title.length > titleWidth ? `${ticket.title.slice(0, titleWidth - 1)}…` : ticket.title;
				return (
					<Text key={`${ticket.project}-${ticket.id}`} inverse={selected} wrap="truncate">
						{' '}
						<Text color={statusColor(ticket.status)}>{glyph}</Text> <Text dimColor>#{ticket.id}</Text> {title}
						{ticket.archived ? <Text dimColor> (archived)</Text> : null}{' '}
						<Text dimColor>{relativeTime(ticket.updated ?? ticket.created)}</Text>
					</Text>
				);
			})}
		</Box>
	);
}
