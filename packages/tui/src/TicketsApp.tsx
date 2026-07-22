import { TicketsClient, type TicketsMeta, type TicketWithProject } from '@aylith/tickets-core';
import fuzzysort from 'fuzzysort';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandBar } from './CommandBar';
import { clipboardHint, copyToClipboard } from './clipboard';
import { buildRows, groupByProject, type ListRow, locationLabel } from './format';
import { HelpModal } from './HelpModal';
import { TicketList } from './TicketList';
import { TicketPreview } from './TicketPreview';

type Mode = 'normal' | 'filter';

const firstTicketRow = (rows: ListRow[], from: number, dir: 1 | -1): number => {
	for (let index = from; index >= 0 && index < rows.length; index += dir) {
		if (rows[index]?.kind === 'ticket') return index;
	}
	for (let index = dir === 1 ? 0 : rows.length - 1; index >= 0 && index < rows.length; index += dir) {
		if (rows[index]?.kind === 'ticket') return index;
	}
	return -1;
};

export function TicketsApp({ apiBase }: { apiBase: string }) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const client = useMemo(() => new TicketsClient(apiBase), [apiBase]);

	const [meta, setMeta] = useState<TicketsMeta>();
	const [tickets, setTickets] = useState<TicketWithProject[]>([]);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	const [filter, setFilter] = useState('');
	const [mode, setMode] = useState<Mode>('normal');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [helpOpen, setHelpOpen] = useState(false);
	const [showArchived, setShowArchived] = useState(false);
	const [terminalIndex, setTerminalIndex] = useState(0);
	const [busy, setBusy] = useState(false);
	const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const width = stdout?.columns ?? 100;
	const height = stdout?.rows ?? 30;

	const flash = useCallback((message: string) => {
		setStatus(message);
		clearTimeout(statusTimer.current);
		statusTimer.current = setTimeout(() => setStatus(''), 4000);
	}, []);

	const refresh = useCallback(async () => {
		try {
			const [nextMeta, nextTickets] = await Promise.all([client.meta(), client.list({ archived: showArchived })]);
			setMeta(nextMeta);
			setTickets(nextTickets);
			setError('');
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : 'Cannot reach the tickets daemon');
		}
	}, [client, showArchived]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Live refresh via SSE, with a slow poll as a safety net.
	useEffect(() => {
		let dispose: (() => void) | undefined;
		try {
			dispose = client.subscribe(() => void refresh());
		} catch {
			// EventSource unavailable — rely on polling
		}
		const poll = setInterval(() => void refresh(), 15000);
		return () => {
			dispose?.();
			clearInterval(poll);
		};
	}, [client, refresh]);

	const filtered = useMemo(() => {
		if (!filter.trim()) return tickets;
		const results = fuzzysort.go(filter.trim(), tickets, {
			keys: ['title', 'id', 'project', 'status'],
			threshold: -10000,
		});
		return results.map((result) => result.obj);
	}, [tickets, filter]);

	const rows = useMemo(() => buildRows(groupByProject(filtered)), [filtered]);

	// The cursor never has to sit exactly on a ticket row — the effective
	// selection snaps to the nearest ticket, so headers and data changes never
	// leave the preview on "nothing selected".
	const effectiveIndex = useMemo(() => {
		if (rows[selectedIndex]?.kind === 'ticket') return selectedIndex;
		const seek = firstTicketRow(rows, selectedIndex, 1);
		return seek >= 0 ? seek : selectedIndex;
	}, [rows, selectedIndex]);

	const selectedRow = rows[effectiveIndex];
	const selected = selectedRow?.kind === 'ticket' ? selectedRow.ticket : undefined;

	const move = useCallback(
		(dir: 1 | -1) => {
			const next = firstTicketRow(rows, effectiveIndex + dir, dir);
			if (next >= 0) setSelectedIndex(next);
		},
		[rows, effectiveIndex],
	);

	const runAction = useCallback(
		async (label: string, action: () => Promise<void>) => {
			if (busy) return;
			setBusy(true);
			try {
				await action();
			} catch (actionError) {
				flash(`${label} failed: ${actionError instanceof Error ? actionError.message : 'error'}`);
			} finally {
				setBusy(false);
			}
		},
		[busy, flash],
	);

	useInput((input, key) => {
		if (mode === 'filter') {
			if (key.escape || key.return) setMode('normal');
			return;
		}
		if (helpOpen) {
			if (input === '?' || key.escape || input === 'q') setHelpOpen(false);
			return;
		}
		if (input === 'q' || key.escape || (key.ctrl && input === 'c')) return exit();
		if (input === '?') return setHelpOpen(true);
		if (key.downArrow || input === 'j') return move(1);
		if (key.upArrow || input === 'k') return move(-1);
		if (input === 'g') return setSelectedIndex(firstTicketRow(rows, 0, 1));
		if (input === 'G') return setSelectedIndex(firstTicketRow(rows, rows.length - 1, -1));
		if (input === '/') return setMode('filter');
		if (input === 'r') return void refresh();
		if (input === 'A') {
			setShowArchived((value) => !value);
			return;
		}
		if (input === 't' && meta && meta.terminals.length > 0) {
			setTerminalIndex((index) => (index + 1) % meta.terminals.length);
			return;
		}
		if (!selected || !meta) return;
		const { project, id } = selected;
		if (key.return) {
			const terminal = meta.terminals[terminalIndex];
			if (!terminal) return;
			return void runAction('launch', async () => {
				await client.launch(project, id, terminal.id);
				flash(`launched #${id} in ${terminal.label} — now in_progress`);
			});
		}
		if (input === 'c') {
			return void runAction('copy', async () => {
				await copyToClipboard(await client.prompt(project, id));
				flash(`prompt for #${id} copied ${clipboardHint()}`);
			});
		}
		if (input === 'e') {
			flash(`enriching #${id}…`);
			return void runAction('enrich', async () => {
				await client.enrich(project, id);
				flash(`enriched #${id} — press u to undo`);
			});
		}
		if (input === 'u') {
			return void runAction('undo', async () => {
				const revisions = await client.revisions(project, id);
				const previous = revisions[1];
				if (!previous) {
					flash('no earlier revision to restore');
					return;
				}
				await client.restore(project, id, previous.ref);
				flash(`restored #${id} to the previous revision`);
			});
		}
		if (input === 's') {
			const order = meta.statuses;
			const nextStatus = order[(order.indexOf(selected.status) + 1) % order.length];
			if (!nextStatus) return;
			return void runAction('status', async () => {
				await client.patch(project, id, { status: nextStatus });
				flash(`#${id} → ${nextStatus}`);
			});
		}
		if (input === 'a') {
			return void runAction('archive', async () => {
				await client.archive(project, id);
				flash(`archived #${id}`);
			});
		}
	});

	const terminalLabel = meta?.terminals[terminalIndex]?.label ?? '—';
	const selectedLocation = selected
		? meta?.projects.find((project) => project.name === selected.project)?.location
		: undefined;
	const listHeight = Math.max(3, height - 5);
	const listWidth = Math.floor(width * 0.5);

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Box justifyContent="space-between">
				<Text bold color="magenta">
					tickets
					<Text dimColor> · all projects</Text>
				</Text>
				<Text dimColor>
					launch → {terminalLabel}
					{showArchived ? ' · incl. archived' : ''}
					{busy ? ' · working…' : ''}
				</Text>
			</Box>
			{selected && selectedLocation ? (
				<Text dimColor>
					{selected.project} · {locationLabel(selectedLocation)}
				</Text>
			) : null}

			{error ? (
				<Box paddingY={1}>
					<Text color="red">{error}</Text>
				</Box>
			) : helpOpen ? (
				<Box paddingY={1}>
					<HelpModal width={width} />
				</Box>
			) : (
				<Box>
					<Box width={listWidth}>
						<TicketList rows={rows} selectedIndex={effectiveIndex} height={listHeight} width={listWidth} />
					</Box>
					<Box borderStyle="round" borderColor="gray" flexGrow={1}>
						<TicketPreview ticket={selected} width={width - listWidth - 4} height={listHeight - 2} />
					</Box>
				</Box>
			)}

			<CommandBar
				mode={mode}
				filter={filter}
				onFilterChange={setFilter}
				onFilterSubmit={() => setMode('normal')}
				status={status}
				count={filtered.length}
				total={tickets.length}
			/>
		</Box>
	);
}
