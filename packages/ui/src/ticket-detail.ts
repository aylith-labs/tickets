import type { TicketRevision } from '@aylith/tickets-core';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { TicketsClient, TicketsMeta, TicketWithProject } from './client';
import { tokens } from './theme';
import './status-chip';

@customElement('ay-ticket-detail')
export class AyTicketDetail extends LitElement {
	static styles = [
		tokens,
		css`
			.backdrop {
				position: fixed;
				inset: 0;
				background: rgb(0 0 0 / 0.45);
				display: flex;
				align-items: flex-start;
				justify-content: center;
				padding: 4rem 1rem 2rem;
				z-index: 40;
			}

			.panel {
				width: min(46rem, 100%);
				max-height: calc(100dvh - 6rem);
				overflow-y: auto;
				background: var(--_bg);
				border: 1px solid var(--_border);
				border-radius: calc(var(--_radius) + 4px);
				padding: 1.25rem;
				display: flex;
				flex-direction: column;
				gap: 1rem;
			}

			header {
				display: flex;
				align-items: center;
				gap: 0.75rem;
			}

			h2 {
				flex: 1;
				margin: 0;
				font-size: 1.05rem;
				line-height: 1.35;
			}

			.mono {
				font-family: var(--_font-mono);
				font-size: 0.75rem;
				color: var(--_text-muted);
			}

			.description {
				white-space: pre-wrap;
				font-size: 0.875rem;
				line-height: 1.55;
				background: var(--_surface);
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				padding: 0.85rem;
				margin: 0;
			}

			.description:empty::before {
				content: 'No description.';
				color: var(--_text-muted);
			}

			.edit-grid {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}

			.edit-grid textarea {
				min-height: 10rem;
				resize: vertical;
			}

			.section-title {
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				color: var(--_text-muted);
				margin: 0 0 0.5rem;
			}

			.gallery {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
				gap: 0.75rem;
			}

			figure {
				margin: 0;
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				overflow: hidden;
				background: var(--_surface);
			}

			figure img,
			figure video {
				display: block;
				width: 100%;
				aspect-ratio: 16 / 10;
				object-fit: contain;
				background: var(--_surface-raised);
			}

			figcaption {
				display: flex;
				justify-content: space-between;
				gap: 0.5rem;
				font-size: 0.75rem;
				color: var(--_text-muted);
				padding: 0.4rem 0.6rem;
			}

			.kind {
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.revisions {
				display: flex;
				flex-direction: column;
				gap: 0.35rem;
			}

			.revision {
				display: flex;
				align-items: center;
				gap: 0.75rem;
				font-size: 0.8125rem;
				padding: 0.35rem 0.5rem;
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				background: var(--_surface);
			}

			.revision .message {
				flex: 1;
			}

			footer {
				display: flex;
				gap: 0.5rem;
				justify-content: space-between;
			}

			.spacer {
				flex: 1;
			}

			.danger-btn {
				color: var(--_danger);
				border-color: color-mix(in srgb, var(--_danger) 40%, var(--_border));
			}

			.upload-row {
				display: flex;
				gap: 0.5rem;
			}

			.upload-error {
				color: var(--_danger);
				font-size: 0.8125rem;
				margin-top: 0.5rem;
			}
		`,
	];

	@property({ attribute: false }) ticket!: TicketWithProject;
	@property({ attribute: false }) client!: TicketsClient;
	@property({ attribute: false }) meta?: TicketsMeta;

	@state() private editing = false;
	@state() private revisions: TicketRevision[] = [];
	@state() private uploading = '';
	@state() private uploadError = '';

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.loadRevisions();
	}

	private async loadRevisions(): Promise<void> {
		this.revisions = await this.client.revisions(this.ticket.project, this.ticket.id).catch(() => []);
	}

	private close(): void {
		this.dispatchEvent(new CustomEvent('ay-close', { bubbles: true, composed: true }));
	}

	private changed(ticket: TicketWithProject): void {
		this.ticket = ticket;
		this.dispatchEvent(new CustomEvent('ay-changed', { bubbles: true, composed: true }));
		void this.loadRevisions();
	}

	private async saveEdit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		const updated = await this.client.patch(this.ticket.project, this.ticket.id, {
			title: String(data.get('title') ?? '').trim(),
			description: String(data.get('description') ?? ''),
		});
		this.editing = false;
		this.changed(updated);
	}

	private async setStatus(event: Event): Promise<void> {
		const status = (event.currentTarget as HTMLSelectElement).value;
		this.changed(await this.client.patch(this.ticket.project, this.ticket.id, { status }));
	}

	private async restore(ref: string): Promise<void> {
		this.changed(await this.client.restore(this.ticket.project, this.ticket.id, ref));
	}

	private async archive(): Promise<void> {
		await this.client.archive(this.ticket.project, this.ticket.id);
		this.dispatchEvent(new CustomEvent('ay-changed', { bubbles: true, composed: true }));
		this.close();
	}

	private async upload(event: Event, kind: 'before' | 'after'): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		this.uploading = kind;
		this.uploadError = '';
		try {
			this.changed(await this.client.attach(this.ticket.project, this.ticket.id, file, kind));
		} catch (error) {
			this.uploadError = error instanceof Error ? error.message : 'Upload failed';
		} finally {
			this.uploading = '';
		}
	}

	render() {
		const { ticket } = this;
		const before = ticket.attachments.filter((attachment) => attachment.kind === 'before');
		const after = ticket.attachments.filter((attachment) => attachment.kind === 'after');
		const other = ticket.attachments.filter((attachment) => attachment.kind === 'other');
		return html`
			<div class="backdrop" @click=${(event: Event) => event.target === event.currentTarget && this.close()}>
				<div class="panel" role="dialog" aria-modal="true" aria-label="Ticket ${ticket.id}">
					<header>
						<span class="mono">${ticket.project} / #${ticket.id}</span>
						<span class="spacer"></span>
						<select .value=${ticket.status} @change=${this.setStatus} aria-label="Status">
							${this.meta?.statuses.map(
								(status) =>
									html`<option value=${status} ?selected=${status === ticket.status}>${status.replace(/_/g, ' ')}</option>`,
							)}
						</select>
						<button class="btn" @click=${this.close}>Close</button>
					</header>

					${
						this.editing
							? html`
								<form class="edit-grid" @submit=${this.saveEdit}>
									<input name="title" .value=${ticket.title} required />
									<textarea name="description" .value=${ticket.description}></textarea>
									<div>
										<button class="btn btn-primary" type="submit">Save</button>
										<button class="btn" type="button" @click=${() => {
											this.editing = false;
										}}>Cancel</button>
									</div>
								</form>
							`
							: html`
								<h2>${ticket.title}</h2>
								<pre class="description">${ticket.description}</pre>
								<div><button class="btn" @click=${() => {
									this.editing = true;
								}}>Edit</button></div>
							`
					}

					${[
						{ heading: 'Before', items: before },
						{ heading: 'After', items: after },
						{ heading: 'Media', items: other },
					].map(({ heading, items }) =>
						items.length === 0
							? null
							: html`
								<section>
									<h3 class="section-title">${heading}</h3>
									<div class="gallery">
										${items.map(
											(attachment) => html`
												<figure>
													${
														attachment.type === 'video'
															? html`<video src=${attachment.url} controls preload="metadata"></video>`
															: html`<a href=${attachment.url} target="_blank" rel="noreferrer"
																><img src=${attachment.url} alt=${attachment.label ?? attachment.kind} loading="lazy"
															/></a>`
													}
													<figcaption>
														<span class="kind">${attachment.kind}</span>
														${attachment.label ? html`<span>${attachment.label}</span>` : null}
													</figcaption>
												</figure>
											`,
										)}
									</div>
								</section>
							`,
					)}

					${
						this.revisions.length > 1
							? html`
								<section>
									<h3 class="section-title">History</h3>
									<div class="revisions">
										${this.revisions.map(
											(revision, index) => html`
												<div class="revision">
													<span class="mono">${revision.ref.slice(0, 8)}</span>
													<span class="message">${revision.message}</span>
													<span class="mono">${new Date(revision.at).toLocaleString()}</span>
													${
														index === 0
															? html`<span class="mono">current</span>`
															: html`<button class="btn" @click=${() => this.restore(revision.ref)}>Restore</button>`
													}
												</div>
											`,
										)}
									</div>
								</section>
							`
							: null
					}

					<section>
						<h3 class="section-title">Evidence</h3>
						<div class="upload-row">
							${(['before', 'after'] as const).map(
								(kind) => html`
									<label class="btn">
										${this.uploading === kind ? 'Uploading…' : `Add ${kind} media`}
										<input
											type="file"
											accept="image/*,video/*"
											hidden
											?disabled=${this.uploading.length > 0}
											@change=${(event: Event) => this.upload(event, kind)}
										/>
									</label>
								`,
							)}
						</div>
						${this.uploadError ? html`<div class="upload-error">${this.uploadError}</div>` : null}
					</section>

					<footer>
						<button class="btn danger-btn" @click=${this.archive} ?disabled=${ticket.archived}>
							${ticket.archived ? 'Archived' : 'Archive'}
						</button>
					</footer>
				</div>
			</div>
		`;
	}
}
