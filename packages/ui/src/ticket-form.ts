import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { TicketsClient, TicketsMeta } from './client';
import { tokens } from './theme';

/** Quick title + description capture. Emits `ay-created` with the new ticket. */
@customElement('ay-ticket-form')
export class AyTicketForm extends LitElement {
	static styles = [
		tokens,
		css`
			:host {
				display: block;
				min-width: 0;
			}

			form {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
				padding: 0.85rem;
				background: var(--_surface);
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
			}

			.row {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 0.5rem;
			}

			input,
			textarea,
			select {
				min-width: 0;
				max-width: 100%;
			}

			input[name='title'] {
				flex: 1 1 16rem;
			}

			textarea {
				resize: vertical;
				min-height: 4.5rem;
				font-size: 0.875rem;
			}

			select {
				flex: 1 1 10rem;
				max-width: 12rem;
			}

			.btn {
				min-height: 2.75rem;
				height: auto;
				max-width: 100%;
				white-space: normal;
				justify-content: center;
				padding-block: 0.5rem;
			}

			button:disabled {
				cursor: default;
				opacity: 0.65;
			}

			.status,
			.error {
				font-size: 0.8125rem;
				overflow-wrap: anywhere;
			}

			.status {
				color: var(--_text-muted);
			}

			.error {
				color: var(--_danger);
			}
		`,
	];

	@property({ attribute: false }) client!: TicketsClient;
	/** Fixed project (embedded page) — hides the project selector. */
	@property() project = '';

	@state() private meta?: TicketsMeta;
	@state() private busy = false;
	@state() private error = '';
	@state() private metaLoading = false;
	@state() private metaError = '';
	private metaRequest = 0;

	connectedCallback(): void {
		super.connectedCallback();
		if (this.hasUpdated) void this.loadProjects();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.metaRequest += 1;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has('client') || changed.has('project')) void this.loadProjects();
	}

	private async loadProjects(restoreFocus = false): Promise<void> {
		const request = ++this.metaRequest;
		this.meta = undefined;
		this.metaError = '';
		this.metaLoading = !this.project;
		if (this.project) return;
		try {
			const meta = await this.client.meta();
			if (request !== this.metaRequest) return;
			this.meta = meta;
		} catch (error) {
			if (request !== this.metaRequest) return;
			this.metaError = error instanceof Error ? error.message : 'Projects are unavailable';
		} finally {
			if (request === this.metaRequest) {
				this.metaLoading = false;
				if (restoreFocus && this.meta) {
					await this.updateComplete;
					this.renderRoot.querySelector<HTMLSelectElement>('select')?.focus();
				}
			}
		}
	}

	/** The form is mounted on demand (toggled open) — always land focus in the title. */
	firstUpdated(): void {
		this.focusTitle();
	}

	private focusTitle(): void {
		this.renderRoot.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
	}

	private async submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (this.busy) return;
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		const title = String(data.get('title') ?? '').trim();
		const project = this.project || String(data.get('project') ?? '');
		if (!title) {
			this.error = 'Enter a title with more than spaces.';
			this.focusTitle();
			return;
		}
		if (!project || (!this.project && (this.metaLoading || !this.meta))) return;
		const client = this.client;
		const fixedProject = this.project;
		this.busy = true;
		this.error = '';
		try {
			const ticket = await client.create(project, title, String(data.get('description') ?? ''));
			if (this.isConnected && this.client === client && this.project === fixedProject) {
				// Keep the selected project for embedded consumers that leave the form open.
				for (const name of ['title', 'description']) {
					const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
					field.value = '';
				}
				this.dispatchEvent(new CustomEvent('ay-created', { detail: ticket, bubbles: true, composed: true }));
			}
		} catch (creationError) {
			if (this.client === client && this.project === fixedProject) {
				const reason = creationError instanceof Error ? creationError.message : 'Please try again.';
				this.error = `Could not create ticket. Your draft is kept. ${reason}`;
			}
		} finally {
			this.busy = false;
			await this.updateComplete;
			if (this.isConnected && this.client === client && this.project === fixedProject) this.focusTitle();
		}
	}

	render() {
		const projects = this.meta?.projects ?? [];
		const nameCounts = new Map<string, number>();
		for (const project of projects) nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1);
		const hasProjects = projects.some((project) => !project.unavailable);
		const canCreate = Boolean(this.project) || (!this.metaLoading && hasProjects);
		return html`
			<form @submit=${this.submit} aria-label="Create ticket" aria-busy=${this.busy}>
				<div class="row">
					<input
						name="title"
						aria-label="Title"
						placeholder="What needs fixing or building?"
						required
						autocomplete="off"
						?readonly=${this.busy}
					/>
					${
						this.project
							? null
							: html`<select name="project" aria-label="Project" required ?disabled=${this.busy || !canCreate}>
								<option value="">${this.metaLoading ? 'Loading projects…' : 'Choose project'}</option>
								${projects.map(
									(
										project,
									) => html`<option value=${project.id ?? project.name} ?disabled=${Boolean(project.unavailable)}>
										${project.name}${(nameCounts.get(project.name) ?? 0) > 1 ? ` (${project.id ?? project.repoPath})` : ''}${project.unavailable ? ' — unavailable' : ''}
									</option>`,
								)}
							</select>`
					}
					<button class="btn btn-primary" type="submit" ?disabled=${this.busy || !canCreate}>
						${this.busy ? 'Creating…' : 'Create ticket'}
					</button>
				</div>
				<textarea
					name="description"
					aria-label="Description"
					?readonly=${this.busy}
					placeholder="Details, steps to reproduce, acceptance criteria… (markdown)"
				></textarea>
				<div class="status" role="status">${this.busy ? 'Creating ticket…' : this.metaLoading ? 'Loading projects…' : ''}</div>
				${
					this.metaError
						? html`<div class="error" role="alert">Could not load projects. ${this.metaError}</div>
							<button class="btn" type="button" @click=${() => this.loadProjects(true)}>Retry projects</button>`
						: null
				}
				${
					!this.project && this.meta && !hasProjects
						? html`<div class="status" role="status">No available projects. Initialize or reconnect a project, then reopen this form.</div>`
						: null
				}
				${this.error ? html`<div class="error" role="alert">${this.error}</div>` : null}
			</form>
		`;
	}
}
