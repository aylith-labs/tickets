import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens } from './theme';

const STATUS_HUES: Record<string, string> = {
	todo: 'light-dark(#71717a, #9d9daa)',
	in_progress: 'light-dark(#2563eb, #60a5fa)',
	in_review: 'light-dark(#d97706, #fbbf24)',
	done: 'light-dark(#16a34a, #4ade80)',
};

@customElement('ay-status-chip')
export class AyStatusChip extends LitElement {
	static styles = [
		tokens,
		css`
			.chip {
				display: inline-flex;
				align-items: center;
				gap: 0.35em;
				font-size: 0.6875rem;
				font-weight: 600;
				letter-spacing: 0.03em;
				text-transform: uppercase;
				padding: 0.15rem 0.5rem;
				border-radius: 999px;
				border: 1px solid color-mix(in srgb, var(--_status) 35%, transparent);
				color: var(--_status);
				background: color-mix(in srgb, var(--_status) 10%, transparent);
				white-space: nowrap;
			}

			.dot {
				width: 0.4em;
				height: 0.4em;
				border-radius: 999px;
				background: var(--_status);
			}
		`,
	];

	@property() status = 'todo';

	render() {
		const hue = STATUS_HUES[this.status] ?? STATUS_HUES.todo;
		return html`<span class="chip" style="--_status: ${hue}"
			><span class="dot"></span>${this.status.replace(/_/g, ' ')}</span
		>`;
	}
}
