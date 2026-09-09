/** Browser-safe projection only. Reading a reference does not confer Hub access. */
export function incidentSource(
	value: unknown,
	projectId: string | undefined,
): { state: 'absent' | 'unsupported' } | { state: 'linked'; href: string } {
	if (value === undefined) return { state: 'absent' };
	const record = (item: unknown): item is Record<string, unknown> =>
		!!item && typeof item === 'object' && !Array.isArray(item);
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		value.projectId !== projectId ||
		!projectId ||
		typeof value.hubOrigin !== 'string' ||
		!record(value.incident) ||
		typeof value.incident.id !== 'string' ||
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.incident.id)
	) {
		return { state: 'unsupported' };
	}
	try {
		const origin = new URL(value.hubOrigin);
		if (
			origin.protocol !== 'http:' ||
			origin.hostname !== '127.0.0.1' ||
			!origin.port ||
			origin.origin !== value.hubOrigin
		) {
			return { state: 'unsupported' };
		}
		return { state: 'linked', href: `${origin.origin}/?incident=${value.incident.id}` };
	} catch {
		return { state: 'unsupported' };
	}
}
