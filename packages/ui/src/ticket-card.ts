import type { TicketRevision } from '@aylith/tickets-core';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { TicketsClient, TicketsMeta, TicketWithProject } from './client';
import type { KebabItem } from './kebab-menu';
import { tokens } from './theme';
import './kebab-menu';
import './status-chip';

/** Present only when the ticket's most recent change is an AI enrich. */
type UndoState = {
	/** The revision the undo restores (the state right before the enrich). */
	target: TicketRevision;
	/** Ticket content at that revision — what the undo will bring back. */
	restored: TicketWithProject;
};

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

	@state() private undo?: UndoState;

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

	/**
	 * Runs when the kebab opens: "Undo last enrich" only exists while the
	 * ticket's most recent revision IS an enrich — and it previews the exact
	 * content the undo restores.
	 */
	private async loadUndoState(): Promise<void> {
		this.undo = undefined;
		const { project, id } = this.ticket;
		try {
			const [latest, previous] = await this.client.revisions(project, id);
			if (!latest || !previous || !latest.message.startsWith('Enrich ')) return;
			const restored = await this.client.revision(project, id, previous.ref);
			this.undo = { target: previous, restored };
		} catch {
			// no revision history (e.g. folder adapter) — keep the item hidden
		}
	}

	private undoItem({ target, restored }: UndoState): KebabItem {
		const { project, id } = this.ticket;
		const titleChanged = restored.title !== this.ticket.title;
		const descriptionChanged = restored.description !== this.ticket.description;
		return {
			label: 'Undo last enrich',
			preview: html`
				<p class="preview-title">Undo the AI enrich</p>
				<p class="preview-note">
					Restores the ticket to how it was before the enrich (${new Date(target.at).toLocaleString()}).
				</p>
				<div>
					<p class="preview-label">Title after undo${titleChanged ? '' : ' — unchanged'}</p>
					<p class="preview-block">${restored.title}</p>
				</div>
				<div>
					<p class="preview-label">Description after undo${descriptionChanged ? '' : ' — unchanged'}</p>
					<p class="preview-block">${restored.description.trim() || html`<span class="preview-muted">Empty</span>`}</p>
				</div>
			`,
			action: () =>
				this.guard(async () => {
					await this.client.restore(project, id, target.ref);
					this.undo = undefined;
					this.notify('Enrich undone — previous title and description restored');
					this.changed();
				}),
		};
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
		items.push({
			label: 'Enrich with AI',
			action: () =>
				this.guard(async () => {
					this.notify('Enriching…');
					await this.client.enrich(project, id);
					this.notify('Ticket enriched — undo is in the menu');
					this.changed();
				}),
		});
		if (this.undo) items.push(this.undoItem(this.undo));
		items.push({
			label: 'Archive',
			danger: true,
			action: () =>
				this.guard(async () => {
					await this.client.archive(project, id);
					this.notify(`Ticket ${id} archived`);
					this.changed();
				}),
		});
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
				<ay-kebab-menu .items=${this.kebabItems()} @ay-menu-open=${() => void this.loadUndoState()}></ay-kebab-menu>
			</div>
		`;
	}
}
