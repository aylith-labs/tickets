import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens } from './theme';

export type KebabItem = {
	label: string;
	action: () => void | Promise<void>;
	danger?: boolean;
	disabled?: boolean;
};

@customElement('ay-kebab-menu')
export class AyKebabMenu extends LitElement {
	static styles = [
		tokens,
		css`
			:host {
				position: relative;
				display: inline-block;
			}

			.trigger {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 1.75rem;
				height: 1.75rem;
				border-radius: var(--_radius);
				color: var(--_text-muted);
			}

			.trigger:hover {
				background: var(--_surface-raised);
				color: var(--_text);
			}

			.menu {
				position: absolute;
				right: 0;
				top: calc(100% + 4px);
				min-width: 13rem;
				background: var(--_surface);
				border: 1px solid var(--_border);
				border-radius: var(--_radius);
				box-shadow: 0 8px 24px light-dark(rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.5));
				padding: 0.25rem;
				z-index: 30;
				display: flex;
				flex-direction: column;
			}

			.item {
				text-align: left;
				padding: 0.45rem 0.6rem;
				border-radius: calc(var(--_radius) - 2px);
				font-size: 0.8125rem;
				white-space: nowrap;
			}

			.item:hover:not(:disabled) {
				background: var(--_surface-raised);
			}

			.item.danger {
				color: var(--_danger);
			}

			.item:disabled {
				color: var(--_text-muted);
				cursor: default;
				opacity: 0.6;
			}
		`,
	];

	@property({ attribute: false }) items: KebabItem[] = [];
	@state() private open = false;

	private readonly onOutsideClick = (event: MouseEvent) => {
		if (!event.composedPath().includes(this)) this.close();
	};

	private readonly onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') this.close();
	};

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.close();
	}

	private toggle(): void {
		if (this.open) this.close();
		else {
			this.open = true;
			document.addEventListener('click', this.onOutsideClick);
			document.addEventListener('keydown', this.onKeydown);
		}
	}

	private close(): void {
		this.open = false;
		document.removeEventListener('click', this.onOutsideClick);
		document.removeEventListener('keydown', this.onKeydown);
	}

	private async run(item: KebabItem): Promise<void> {
		this.close();
		await item.action();
	}

	render() {
		return html`
			<button
				class="trigger"
				aria-label="Ticket actions"
				aria-haspopup="menu"
				aria-expanded=${this.open}
				@click=${(event: Event) => {
					event.stopPropagation();
					this.toggle();
				}}
			>
				<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
					<circle cx="12" cy="5" r="1.6"></circle>
					<circle cx="12" cy="12" r="1.6"></circle>
					<circle cx="12" cy="19" r="1.6"></circle>
				</svg>
			</button>
			${
				this.open
					? html`<div class="menu" role="menu" @click=${(event: Event) => event.stopPropagation()}>
						${this.items.map(
							(item) => html`
								<button
									class="item ${item.danger ? 'danger' : ''}"
									role="menuitem"
									?disabled=${item.disabled}
									@click=${() => this.run(item)}
								>
									${item.label}
								</button>
							`,
						)}
					</div>`
					: null
			}
		`;
	}
}
