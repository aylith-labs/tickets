import type { Attachment } from './types/Attachment';
import type { Ticket } from './types/Ticket';
import type { TicketRevision } from './types/TicketRevision';

export type TicketWithProject = Ticket & { project: string };

export type TicketsMeta = {
	projects: Array<{ name: string; repoPath: string; adapter: string }>;
	statuses: string[];
	terminals: Array<{ id: string; label: string }>;
	enrichProviders: string[];
	apiBase: string;
};

const jsonInit = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});

const ensureOk = async (response: Response): Promise<Response> => {
	if (response.ok) return response;
	let message = `${response.status} ${response.statusText}`;
	try {
		const payload = (await response.json()) as { error?: string };
		if (payload.error) message = payload.error;
	} catch {
		// keep the status text
	}
	throw new Error(message);
};

/** Isomorphic REST client for the tickets daemon — shared by the web UI and the TUI. */
export class TicketsClient {
	private readonly apiBase: string;
	private metaCache?: Promise<TicketsMeta>;

	constructor(apiBase: string) {
		this.apiBase = apiBase.replace(/\/$/, '');
	}

	meta(): Promise<TicketsMeta> {
		this.metaCache ??= fetch(`${this.apiBase}/projects`)
			.then(ensureOk)
			.then((response) => response.json() as Promise<TicketsMeta>);
		return this.metaCache;
	}

	async list(options: { project?: string; archived?: boolean } = {}): Promise<TicketWithProject[]> {
		const params = new URLSearchParams();
		if (options.project) params.set('project', options.project);
		if (options.archived) params.set('archived', 'true');
		const query = params.size > 0 ? `?${params}` : '';
		const response = await ensureOk(await fetch(`${this.apiBase}/tickets${query}`));
		return ((await response.json()) as { tickets: TicketWithProject[] }).tickets;
	}

	async create(project: string, title: string, description: string): Promise<TicketWithProject> {
		const response = await ensureOk(
			await fetch(`${this.apiBase}/tickets`, jsonInit('POST', { project, title, description })),
		);
		return (await response.json()) as TicketWithProject;
	}

	async patch(
		project: string,
		id: string,
		patch: { title?: string; description?: string; status?: string; archived?: boolean },
	): Promise<TicketWithProject> {
		const response = await ensureOk(await fetch(`${this.apiBase}/tickets/${project}/${id}`, jsonInit('PATCH', patch)));
		return (await response.json()) as TicketWithProject;
	}

	async archive(project: string, id: string): Promise<void> {
		await ensureOk(await fetch(`${this.apiBase}/tickets/${project}/${id}/archive`, { method: 'POST' }));
	}

	async prompt(project: string, id: string): Promise<string> {
		const response = await ensureOk(await fetch(`${this.apiBase}/tickets/${project}/${id}/prompt`));
		return response.text();
	}

	async launch(project: string, id: string, terminal: string): Promise<void> {
		await ensureOk(await fetch(`${this.apiBase}/tickets/${project}/${id}/launch`, jsonInit('POST', { terminal })));
	}

	async enrich(project: string, id: string, provider?: string): Promise<TicketWithProject> {
		const response = await ensureOk(
			await fetch(`${this.apiBase}/tickets/${project}/${id}/enrich`, jsonInit('POST', provider ? { provider } : {})),
		);
		return (await response.json()) as TicketWithProject;
	}

	async revisions(project: string, id: string): Promise<TicketRevision[]> {
		const response = await ensureOk(await fetch(`${this.apiBase}/tickets/${project}/${id}/revisions`));
		return ((await response.json()) as { revisions: TicketRevision[] }).revisions;
	}

	async restore(project: string, id: string, ref: string): Promise<TicketWithProject> {
		const response = await ensureOk(
			await fetch(`${this.apiBase}/tickets/${project}/${id}/revisions/${ref}/restore`, { method: 'POST' }),
		);
		return (await response.json()) as TicketWithProject;
	}

	async attach(
		project: string,
		id: string,
		file: File,
		kind: Attachment['kind'],
		label?: string,
	): Promise<TicketWithProject> {
		const form = new FormData();
		form.append('file', file);
		form.append('kind', kind);
		if (label) form.append('label', label);
		const response = await ensureOk(
			await fetch(`${this.apiBase}/tickets/${project}/${id}/attachments`, { method: 'POST', body: form }),
		);
		return (await response.json()) as TicketWithProject;
	}

	/** SSE change feed; returns a dispose function. Requires an `EventSource` global. */
	subscribe(onChange: () => void): () => void {
		const source = new EventSource(`${this.apiBase}/events`);
		source.addEventListener('change', onChange);
		return () => source.close();
	}
}
