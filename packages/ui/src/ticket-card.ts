import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { TicketsClient, TicketsMeta, TicketWithProject } from './client';
import type { KebabItem } from './kebab-menu';
import { tokens } from './theme';
import './kebab-menu';
import './status-chip';

@customElement('ay-ticket-card')
export class AyTicketCard extends LitElement {
	static styles = [
		tokens,
		css`
			.card {
				display: flex;
				align-items: center;
				gap: 0.75rem;
				padding: 0.65rem 0.85rem;
				background: var(--_surface);
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				cursor: pointer;
			}

			.card:hover {
				border-color: color-mix(in srgb, var(--_accent) 45%, var(--_border));
			}

			.id {
				font-family: var(--_font-mono);
				font-size: 0.75rem;
				color: var(--_text-muted);
			}

			.title {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				font-size: 0.875rem;
				font-weight: 500;
			}

			.project {
				font-size: 0.75rem;
				color: var(--_text-muted);
				background: var(--_surface-raised);
				border-radius: 999px;
				padding: 0.1rem 0.55rem;
				white-space: nowrap;
			}

			.media-count {
				font-size: 0.75rem;
				color: var(--_text-muted);
				white-space: nowrap;
			}

			.archived {
				opacity: 0.55;
			}
		`,
	];

	@property({ attribute: false }) ticket!: TicketWithProject;
	@property({ attribute: false }) client!: TicketsClient;
	@property({ attribute: false }) meta?: TicketsMeta;
	/** Hide the project badge on single-project embeds. */
	@property({ type: Boolean }) hideProject = false;

	private notify(message: string): void {
		this.dispatchEvent(new CustomEvent('ay-notify', { detail: { message }, bubbles: true, composed: true }));
	}

	private changed(): void {
		this.dispatchEvent(new CustomEvent('ay-changed', { bubbles: true, composed: true }));
	}

	private async guard(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (error) {
			this.notify(error instanceof Error ? error.message : 'Action failed');
		}
	}

	private kebabItems(): KebabItem[] {
		const { project, id } = this.ticket;
		const items: KebabItem[] = [
			{
				label: 'Copy prompt',
				action: () =>
					this.guard(async () => {
						await navigator.clipboard.writeText(await this.client.prompt(project, id));
						this.notify('Prompt copied to clipboard');
					}),
			},
		];
		for (const terminal of this.meta?.terminals ?? []) {
			items.push({
				label: `Open in ${terminal.label}`,
				action: () =>
					this.guard(async () => {
						await this.client.launch(project, id, terminal.id);
						this.notify(`Launched in ${terminal.label} — ticket is in progress`);
						this.changed();
					}),
			});
		}
		items.push(
			{
				label: 'Enrich with AI',
				action: () =>
					this.guard(async () => {
						this.notify('Enriching…');
						await this.client.enrich(project, id);
						this.notify('Ticket enriched — undo is in the menu');
						this.changed();
					}),
			},
			{
				label: 'Undo last enrich',
				action: () =>
					this.guard(async () => {
						const revisions = await this.client.revisions(project, id);
						const previous = revisions[1];
						if (!previous) {
							this.notify('No earlier revision to restore');
							return;
						}
						await this.client.restore(project, id, previous.ref);
						this.notify('Restored the previous title and description');
						this.changed();
					}),
			},
			{
				label: 'Archive',
				danger: true,
				action: () =>
					this.guard(async () => {
						await this.client.archive(project, id);
						this.notify(`Ticket ${id} archived`);
						this.changed();
					}),
			},
		);
		return items;
	}

	render() {
		const { ticket } = this;
		return html`
			<div
				class="card ${ticket.archived ? 'archived' : ''}"
				@click=${() => this.dispatchEvent(new CustomEvent('ay-open', { detail: ticket, bubbles: true, composed: true }))}
			>
				<span class="id">#${ticket.id}</span>
				<span class="title">${ticket.title}</span>
				${ticket.attachments.length > 0 ? html`<span class="media-count">${ticket.attachments.length} media</span>` : null}
				${this.hideProject ? null : html`<span class="project">${ticket.project}</span>`}
				<ay-status-chip status=${ticket.status}></ay-status-chip>
				<ay-kebab-menu .items=${this.kebabItems()}></ay-kebab-menu>
			</div>
		`;
	}
}
