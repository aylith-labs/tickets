import { Box, Text } from 'ink';

const KEYS: Array<[string, string]> = [
	['↑/↓  j/k', 'move selection'],
	['g / G', 'jump to top / bottom'],
	['enter', 'open a terminal running claude on the ticket'],
	['c', 'copy the composed agent prompt to the clipboard'],
	['e', 'enrich title + description with AI'],
	['u', 'undo the last enrich (restore previous revision)'],
	['s', 'cycle status (todo → in_progress → in_review → done)'],
	['a', 'archive the ticket'],
	['t', 'cycle the terminal used for launch'],
	['/', 'filter tickets (fuzzy); enter/esc to exit'],
	['r', 'refresh from the daemon'],
	['?', 'toggle this help'],
	['q / esc', 'quit'],
];

export function HelpModal({ width }: { width: number }) {
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="magenta"
			paddingX={2}
			paddingY={1}
			width={Math.min(64, width - 4)}
		>
			<Text bold color="magenta">
				tickets — keys
			</Text>
			<Box marginTop={1} flexDirection="column">
				{KEYS.map(([key, description]) => (
					<Text key={key}>
						<Text color="cyan">{key.padEnd(12)}</Text>
						{description}
					</Text>
				))}
			</Box>
		</Box>
	);
}
