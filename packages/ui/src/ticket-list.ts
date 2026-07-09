import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { TicketsClient, type TicketsMeta, type TicketWithProject } from './client';
import { tokens } from './theme';
import './status-chip';
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
				gap: 1.4rem;
			}

			.panes {
				display: flex;
				align-items: flex-start;
			}

			.list-section {
				display: flex;
				flex-direction: column;
				gap: 0.7rem;
				flex: 1;
				min-width: 0;
			}

			.splitter {
				flex: 0 0 9px;
				align-self: stretch;
				min-height: 60vh;
				cursor: col-resize;
				touch-action: none;
				user-select: none;
				position: relative;
				margin: 0 2px;
			}

			.splitter::before {
				content: '';
				position: absolute;
				top: 0;
				bottom: 0;
				left: 4px;
				width: 1px;
				background: var(--_border);
			}

			.splitter:hover::before,
			.splitter.dragging::before {
				left: 3px;
				width: 3px;
				border-radius: 2px;
				background: var(--_accent);
			}

			.detail-pane {
				flex: 0 0 auto;
				min-width: 18rem;
				position: sticky;
				top: 0.5rem;
			}

			.form-slot {
				margin: 0.3rem 0 0.65rem;
			}

			.toolbar {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: 0.5rem 1rem;
				font-size: 0.8125rem;
				color: var(--_text-muted);
				padding: 0 0.15rem;
			}

			.controls {
				flex-wrap: wrap;
				row-gap: 0.5rem;
			}

			.toolbar label {
				white-space: nowrap;
			}

			.badge {
				font-size: 0.6875rem;
				font-variant-numeric: tabular-nums;
				background: var(--_surface-raised);
				border: 1px solid var(--_border);
				border-radius: 999px;
				padding: 0 0.4rem;
				line-height: 1.5;
			}

			.count {
				font-variant-numeric: tabular-nums;
			}

			.controls {
				display: inline-flex;
				align-items: center;
				gap: 1.1rem;
			}

			.view-toggle {
				display: inline-flex;
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				overflow: hidden;
			}

			.view-toggle button {
				font-size: 0.75rem;
				padding: 0.28rem 0.7rem;
				color: var(--_text-muted);
			}

			.view-toggle button + button {
				border-left: 1px solid var(--_border);
			}

			.view-toggle button:hover {
				color: var(--_text);
			}

			.view-toggle button.active {
				background: var(--_surface-raised);
				color: var(--_text);
			}

			.toolbar label {
				display: inline-flex;
				align-items: center;
				gap: 0.45rem;
				cursor: pointer;
				user-select: none;
			}

			.toolbar label:hover {
				color: var(--_text);
			}

			.cards {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
			}

			.board {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
				gap: 0.75rem;
				align-items: start;
			}

			.column {
				display: flex;
				flex-direction: column;
				gap: 0.55rem;
				padding: 0.6rem;
				border-radius: calc(var(--_radius) + 2px);
				background: color-mix(in srgb, var(--_surface-raised) 55%, transparent);
				border: 1px dashed transparent;
				min-height: 9rem;
			}

			.column.drag-over {
				border-color: var(--_accent);
				background: color-mix(in srgb, var(--_accent) 8%, transparent);
			}

			.column-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.5rem;
				padding: 0 0.15rem;
			}

			.column-count {
				font-size: 0.75rem;
				color: var(--_text-muted);
				font-variant-numeric: tabular-nums;
			}

			.column-cards {
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
	@state() private view: 'list' | 'board' = 'list';
	@state() private dragStatus = '';
	@state() private formOpen = false;
	@state() private docked = localStorage.getItem('ay-tickets:detail-dock') === '1';
	@state() private detailWidth = Number(localStorage.getItem('ay-tickets:detail-width')) || 460;
	@state() private splitting = false;

	private unsubscribe?: () => void;
	private toastTimer?: ReturnType<typeof setTimeout>;
	/** Auto-open the form only on the initial load (when there are no tickets yet). */
	private autoOpenChecked = false;

	connectedCallback(): void {
		super.connectedCallback();
		this.view = localStorage.getItem('ay-tickets:view') === 'board' ? 'board' : 'list';
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

	/** Everything (archived included) comes down in one request; visibility filters client-side. */
	private get visibleTickets(): TicketWithProject[] {
		return this.showArchived ? this.tickets : this.tickets.filter((ticket) => !ticket.archived);
	}

	private get archivedCount(): number {
		return this.tickets.reduce((count, ticket) => count + (ticket.archived ? 1 : 0), 0);
	}

	/** Tell the host page when the split layout engages, so it can widen its container. */
	updated(changed: Map<string, unknown>): void {
		if (changed.has('docked') || changed.has('selected')) {
			this.dispatchEvent(
				new CustomEvent('ay-dock-change', {
					detail: { docked: this.docked, split: this.docked && this.selected !== undefined },
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	private async refresh(): Promise<void> {
		try {
			const tickets = await this.client.list({ project: this.project || undefined, archived: true });
			this.tickets = tickets;
			this.loadError = '';
			if (!this.autoOpenChecked) {
				this.autoOpenChecked = true;
				if (tickets.length === 0) this.formOpen = true;
			}
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

	private setView(view: 'list' | 'board'): void {
		this.view = view;
		localStorage.setItem('ay-tickets:view', view);
	}

	private toggleDock(): void {
		this.docked = !this.docked;
		localStorage.setItem('ay-tickets:detail-dock', this.docked ? '1' : '0');
	}

	private onSplitterDown(event: PointerEvent): void {
		event.preventDefault();
		const splitter = event.currentTarget as HTMLElement;
		try {
			splitter.setPointerCapture(event.pointerId);
		} catch {
			// synthetic pointer ids can't be captured — dragging still works over the splitter
		}
		this.splitting = true;
		const startX = event.clientX;
		const startWidth = this.detailWidth;
		const panes = this.renderRoot.querySelector('.panes') as HTMLElement;
		const maxWidth = Math.max(320, panes.getBoundingClientRect().width - 320);
		const onMove = (moveEvent: PointerEvent) => {
			const next = startWidth + (startX - moveEvent.clientX);
			this.detailWidth = Math.min(maxWidth, Math.max(300, Math.round(next)));
		};
		const onUp = () => {
			this.splitting = false;
			splitter.removeEventListener('pointermove', onMove);
			splitter.removeEventListener('pointerup', onUp);
			splitter.removeEventListener('pointercancel', onUp);
			localStorage.setItem('ay-tickets:detail-width', String(this.detailWidth));
		};
		splitter.addEventListener('pointermove', onMove);
		splitter.addEventListener('pointerup', onUp);
		splitter.addEventListener('pointercancel', onUp);
	}

	private async onColumnDrop(event: DragEvent, status: string): Promise<void> {
		event.preventDefault();
		this.dragStatus = '';
		const raw = event.dataTransfer?.getData('application/x-ay-ticket');
		if (!raw) return;
		try {
			const { project, id } = JSON.parse(raw) as { project: string; id: string };
			await this.client.patch(project, id, { status });
			await this.refresh();
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Failed to move the ticket');
		}
	}

	private renderCard(ticket: TicketWithProject, board: boolean) {
		return html`
			<ay-ticket-card
				.ticket=${ticket}
				.client=${this.client}
				.meta=${this.meta}
				?hideProject=${this.project.length > 0}
				?board=${board}
			></ay-ticket-card>
		`;
	}

	private renderBoard() {
		const tickets = this.visibleTickets;
		const statuses = this.meta?.statuses ?? [...new Set(tickets.map((ticket) => ticket.status))];
		return html`
			<div class="board">
				${statuses.map((status) => {
					const columnTickets = tickets.filter((ticket) => ticket.status === status);
					return html`
						<div
							class="column ${this.dragStatus === status ? 'drag-over' : ''}"
							@dragover=${(event: DragEvent) => {
								event.preventDefault();
								if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
								this.dragStatus = status;
							}}
							@dragleave=${(event: DragEvent) => {
								const column = event.currentTarget as HTMLElement;
								if (!column.contains(event.relatedTarget as Node)) this.dragStatus = '';
							}}
							@drop=${(event: DragEvent) => void this.onColumnDrop(event, status)}
						>
							<div class="column-head">
								<ay-status-chip status=${status}></ay-status-chip>
								<span class="column-count">${columnTickets.length}</span>
							</div>
							<div class="column-cards">${columnTickets.map((ticket) => this.renderCard(ticket, true))}</div>
						</div>
					`;
				})}
			</div>
		`;
	}

	render() {
		return html`
			<div
				@ay-created=${() => {
					this.formOpen = false;
					void this.refresh();
				}}
				@ay-changed=${() => this.refresh()}
				@ay-notify=${(event: CustomEvent<{ message: string }>) => this.showToast(event.detail.message)}
				@ay-open=${(event: CustomEvent<TicketWithProject>) => {
					this.selected = event.detail;
				}}
				@ay-close=${() => {
					this.selected = undefined;
				}}
				@ay-dock-toggle=${() => this.toggleDock()}
			>
				<div class="panes">
				<div class="list-section">
					<div class="toolbar">
						<span class="count">${this.visibleTickets.length} ticket${this.visibleTickets.length === 1 ? '' : 's'}</span>
						<div class="controls">
							<div class="view-toggle" role="group" aria-label="View">
								<button class=${this.view === 'list' ? 'active' : ''} @click=${() => this.setView('list')}>
									List
								</button>
								<button class=${this.view === 'board' ? 'active' : ''} @click=${() => this.setView('board')}>
									Board
								</button>
							</div>
							${
								this.archivedCount > 0
									? html`<label>
										Show archived
										<span class="badge">${this.archivedCount}</span>
										<input
											type="checkbox"
											class="switch"
											.checked=${this.showArchived}
											@change=${(event: Event) => {
												this.showArchived = (event.currentTarget as HTMLInputElement).checked;
											}}
										/>
									</label>`
									: null
							}
							<button
								class="btn ${this.formOpen ? '' : 'btn-primary'}"
								aria-expanded=${this.formOpen}
								@click=${() => {
									this.formOpen = !this.formOpen;
								}}
							>
								${this.formOpen ? 'Close' : 'New ticket'}
							</button>
						</div>
					</div>

					${
						this.formOpen
							? html`<div class="form-slot">
								<ay-ticket-form .client=${this.client} project=${this.project}></ay-ticket-form>
							</div>`
							: null
					}

					${this.loadError ? html`<div class="empty">${this.loadError}</div>` : null}
					${
						!this.loadError && this.visibleTickets.length === 0
							? html`<div class="empty">
								${
									this.archivedCount > 0
										? html`Nothing active — flip “Show archived” to see ${this.archivedCount} archived.`
										: html`No tickets yet —
										${this.formOpen ? 'capture the first one above.' : 'hit “New ticket” to capture the first one.'}`
								}
							</div>`
							: null
					}
					${
						this.visibleTickets.length > 0
							? this.view === 'board'
								? this.renderBoard()
								: html`<div class="cards">${this.visibleTickets.map((ticket) => this.renderCard(ticket, false))}</div>`
							: null
					}
				</div>

				${
					this.selected && this.docked
						? html`
							<div
								class="splitter ${this.splitting ? 'dragging' : ''}"
								role="separator"
								aria-orientation="vertical"
								aria-label="Resize the detail pane"
								@pointerdown=${this.onSplitterDown}
							></div>
							<div class="detail-pane" style="width: ${this.detailWidth}px">
								<ay-ticket-detail
									docked
									.ticket=${this.selected}
									.client=${this.client}
									.meta=${this.meta}
								></ay-ticket-detail>
							</div>
						`
						: null
				}
				</div>

				${
					this.selected && !this.docked
						? html`<ay-ticket-detail .ticket=${this.selected} .client=${this.client} .meta=${this.meta}></ay-ticket-detail>`
						: null
				}
				${this.toast ? html`<div class="toast">${this.toast}</div>` : null}
			</div>
		`;
	}
}
