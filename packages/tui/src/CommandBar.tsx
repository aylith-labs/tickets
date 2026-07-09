import { TextInput } from '@inkjs/ui';
import { Box, Text } from 'ink';

type Props = {
	mode: 'normal' | 'filter';
	filter: string;
	onFilterChange: (value: string) => void;
	onFilterSubmit: () => void;
	status: string;
	count: number;
	total: number;
};

const HINTS =
	'enter launch · c copy · e enrich · u undo · a archive · s status · / filter · r refresh · ? help · q quit';

export function CommandBar({ mode, filter, onFilterChange, onFilterSubmit, status, count, total }: Props) {
	return (
		<Box flexDirection="column">
			<Box>
				{mode === 'filter' ? (
					<Box>
						<Text color="cyan">/ </Text>
						<TextInput
							defaultValue={filter}
							placeholder="filter tickets…"
							onChange={onFilterChange}
							onSubmit={onFilterSubmit}
						/>
					</Box>
				) : (
					<Text dimColor wrap="truncate">
						{HINTS}
					</Text>
				)}
			</Box>
			<Box>
				<Text dimColor wrap="truncate">
					{count === total ? `${total} tickets` : `${count}/${total} shown`}
					{status ? '  ·  ' : ''}
				</Text>
				{status ? <Text color="green">{status}</Text> : null}
			</Box>
		</Box>
	);
}
