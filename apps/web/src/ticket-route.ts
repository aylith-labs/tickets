export function readTicketRoute(search: string): { id?: string; error?: string } {
	const ids = new URLSearchParams(search).getAll('ticket');
	if (!ids.length) return {};
	if (ids.length !== 1 || !/^\d{1,16}$/.test(ids[0] ?? '')) return { error: 'Invalid ticket URL' };
	return { id: ids[0] };
}
