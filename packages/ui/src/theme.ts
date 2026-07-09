import { css } from 'lit';

/**
 * Every visual value routes through an --ay-* custom property so host apps can
 * retheme the components; the light-dark() fallbacks make them presentable
 * (and system-theme-aware) out of the box.
 */
export const tokens = css`
	:host {
		color-scheme: light dark;
		--_bg: var(--ay-bg, light-dark(#fafafa, #131316));
		--_surface: var(--ay-surface, light-dark(#ffffff, #1c1c21));
		--_surface-raised: var(--ay-surface-raised, light-dark(#f4f4f5, #26262c));
		--_border: var(--ay-border, light-dark(#e4e4e7, #33333a));
		--_text: var(--ay-text, light-dark(#18181b, #ececf1));
		--_text-muted: var(--ay-text-muted, light-dark(#71717a, #9d9daa));
		--_accent: var(--ay-accent, light-dark(#7c3aed, #a78bfa));
		--_accent-contrast: var(--ay-accent-contrast, light-dark(#ffffff, #17171c));
		--_danger: var(--ay-danger, light-dark(#dc2626, #f87171));
		--_radius: var(--ay-radius, 8px);
		--_font: var(--ay-font, inherit);
		--_font-mono: var(--ay-font-mono, ui-monospace, monospace);
		font-family: var(--_font);
		color: var(--_text);
	}

	button {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		height: 2rem;
		padding: 0 0.75rem;
		border-radius: var(--_radius);
		border: 1px solid var(--_border);
		background: var(--_surface);
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.btn:hover {
		background: var(--_surface-raised);
	}

	.btn-primary {
		background: var(--_accent);
		border-color: var(--_accent);
		color: var(--_accent-contrast);
	}

	.btn-primary:hover {
		filter: brightness(1.08);
		background: var(--_accent);
	}

	input,
	textarea,
	select {
		font: inherit;
		color: var(--_text);
		background: var(--_surface);
		border: 1px solid var(--_border);
		border-radius: var(--_radius);
		padding: 0.45rem 0.65rem;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--_accent);
		outline-offset: 1px;
	}
`;
