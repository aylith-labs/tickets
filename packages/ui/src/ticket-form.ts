import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { TicketsClient, TicketsMeta } from './client';
import { tokens } from './theme';

/** Quick title + description capture. Emits `ay-created` with the new ticket. */
@customElement('ay-ticket-form')
export class AyTicketForm extends LitElement {
	static styles = [
		tokens,
		css`
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
				gap: 0.5rem;
			}

			input[name='title'] {
				flex: 1;
			}

			textarea {
				resize: vertical;
				min-height: 4.5rem;
				font-size: 0.875rem;
			}

			select {
				max-width: 12rem;
			}

			.error {
				color: var(--_danger);
				font-size: 0.8125rem;
			}
		`,
	];

	@property({ attribute: false }) client!: TicketsClient;
	/** Fixed project (embedded page) — hides the project selector. */
	@property() project = '';

	@state() private meta?: TicketsMeta;
	@state() private busy = false;
	@state() private error = '';

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.meta = await this.client.meta();
	}

	/** The form is mounted on demand (toggled open) — always land focus in the title. */
	firstUpdated(): void {
		this.renderRoot.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
	}

	private async submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		const title = String(data.get('title') ?? '').trim();
		const project = this.project || String(data.get('project') ?? '');
		if (!title || !project) return;
		this.busy = true;
		this.error = '';
		try {
			const ticket = await this.client.create(project, title, String(data.get('description') ?? ''));
			form.reset();
			this.dispatchEvent(new CustomEvent('ay-created', { detail: ticket, bubbles: true, composed: true }));
		} catch (creationError) {
			this.error = creationError instanceof Error ? creationError.message : 'Failed to create ticket';
		} finally {
			this.busy = false;
		}
	}

	render() {
		return html`
			<form @submit=${this.submit}>
				<div class="row">
					<input name="title" placeholder="What needs fixing or building?" required autocomplete="off" />
					${
						this.project
							? null
							: html`<select name="project" required>
								${this.meta?.projects.map((project) => html`<option value=${project.name}>${project.name}</option>`)}
							</select>`
					}
					<button class="btn btn-primary" type="submit" ?disabled=${this.busy}>
						${this.busy ? 'Creating…' : 'Create ticket'}
					</button>
				</div>
				<textarea name="description" placeholder="Details, steps to reproduce, acceptance criteria… (markdown)"></textarea>
				${this.error ? html`<div class="error">${this.error}</div>` : null}
			</form>
		`;
	}
}
