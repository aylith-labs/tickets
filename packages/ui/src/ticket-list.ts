import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { TicketsClient, type TicketsMeta, type TicketWithProject } from './client';
import { tokens } from './theme';
import './ticket-card';
import './ticket-detail';
import './ticket-form';

/**
 * The main embeddable surface: quick-capture form + live ticket list + detail
 * dialog. Point it at a daemon with `api-base`; scope it with `project`.
 */
@customElement('ay-ticket-list')
export class AyTicketList extends LitElement {
	static styles = [
		tokens,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: 0.85rem;
			}

			.toolbar {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.75rem;
				font-size: 0.8125rem;
				color: var(--_text-muted);
				padding: 0 0.15rem;
			}

			.count {
				font-variant-numeric: tabular-nums;
			}

			.toolbar label {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
				cursor: pointer;
				user-select: none;
				border-radius: var(--_radius);
			}

			.toolbar label:hover {
				color: var(--_text);
			}

			.cards {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}

			.empty {
				text-align: center;
				color: var(--_text-muted);
				font-size: 0.875rem;
				padding: 2.5rem 1rem;
				border: 1px dashed var(--_border);
				border-radius: var(--_radius);
			}

			.toast {
				position: fixed;
				bottom: 1.25rem;
				left: 50%;
				transform: translateX(-50%);
				background: var(--_text);
				color: var(--_bg);
				font-size: 0.8125rem;
				padding: 0.5rem 0.9rem;
				border-radius: 999px;
				z-index: 50;
				box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
			}
		`,
	];

	@property({ attribute: 'api-base' }) apiBase = '/api';
	@property() project = '';

	@state() private client!: TicketsClient;
	@state() private meta?: TicketsMeta;
	@state() private tickets: TicketWithProject[] = [];
	@state() private showArchived = false;
	@state() private selected?: TicketWithProject;
	@state() private toast = '';
	@state() private loadError = '';

	private unsubscribe?: () => void;
	private toastTimer?: ReturnType<typeof setTimeout>;

	connectedCallback(): void {
		super.connectedCallback();
		this.client = new TicketsClient(this.apiBase);
		void this.client
			.meta()
			.then((meta) => {
				this.meta = meta;
			})
			.catch(() => {
				this.loadError = `Cannot reach the tickets daemon at ${this.apiBase}`;
			});
		void this.refresh();
		this.unsubscribe = this.client.subscribe(() => void this.refresh());
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.unsubscribe?.();
		clearTimeout(this.toastTimer);
	}

	private async refresh(): Promise<void> {
		try {
			const tickets = await this.client.list({ project: this.project || undefined, archived: this.showArchived });
			this.tickets = tickets;
			this.loadError = '';
			if (this.selected) {
				this.selected = tickets.find(
					(ticket) => ticket.project === this.selected?.project && ticket.id === this.selected?.id,
				);
			}
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : 'Failed to load tickets';
		}
	}

	private showToast(message: string): void {
		this.toast = message;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => {
			this.toast = '';
		}, 3500);
	}

	render() {
		return html`
			<div
				@ay-created=${() => this.refresh()}
				@ay-changed=${() => this.refresh()}
				@ay-notify=${(event: CustomEvent<{ message: string }>) => this.showToast(event.detail.message)}
				@ay-open=${(event: CustomEvent<TicketWithProject>) => {
					this.selected = event.detail;
				}}
				@ay-close=${() => {
					this.selected = undefined;
				}}
			>
				<ay-ticket-form .client=${this.client} project=${this.project}></ay-ticket-form>

				<div class="toolbar">
					<span class="count">${this.tickets.length} ticket${this.tickets.length === 1 ? '' : 's'}</span>
					<label>
						<input
							type="checkbox"
							.checked=${this.showArchived}
							@change=${(event: Event) => {
								this.showArchived = (event.currentTarget as HTMLInputElement).checked;
								void this.refresh();
							}}
						/>
						Show archived
					</label>
				</div>

				${this.loadError ? html`<div class="empty">${this.loadError}</div>` : null}
				${
					!this.loadError && this.tickets.length === 0
						? html`<div class="empty">No tickets yet — capture the first one above.</div>`
						: null
				}

				<div class="cards">
					${this.tickets.map(
						(ticket) => html`
							<ay-ticket-card
								.ticket=${ticket}
								.client=${this.client}
								.meta=${this.meta}
								?hideProject=${this.project.length > 0}
							></ay-ticket-card>
						`,
					)}
				</div>

				${
					this.selected
						? html`<ay-ticket-detail .ticket=${this.selected} .client=${this.client} .meta=${this.meta}></ay-ticket-detail>`
						: null
				}
				${this.toast ? html`<div class="toast">${this.toast}</div>` : null}
			</div>
		`;
	}
}
