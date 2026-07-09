import { css } from 'lit';

/**
 * Every visual value routes through an --ay-* custom property so host apps can
 * retheme the components; the light-dark() fallbacks make them presentable
 * (and system-theme-aware) out of the box. Defaults follow the aylith brand —
 * warm-stone surfaces and a copper accent.
 */
export const tokens = css`
	*,
	*::before,
	*::after {
		box-sizing: border-box;
	}

	:host {
		/* Inherit color-scheme from the host root so its light/dark/system choice
		   (or an app's forced theme) drives the light-dark() fallbacks. */
		--_bg: var(--ay-bg, light-dark(#f8f7f4, #131110));
		--_surface: var(--ay-surface, light-dark(#ffffff, #1c1a16));
		--_surface-raised: var(--ay-surface-raised, light-dark(#f0eee9, #26231d));
		--_border: var(--ay-border, light-dark(#e1ddd3, #332f29));
		--_text: var(--ay-text, light-dark(#1c1a16, #f3efe8));
		--_text-muted: var(--ay-text-muted, light-dark(#615b50, #b0a08a));
		--_accent: var(--ay-accent, light-dark(#c97a3a, #e0a86b));
		--_accent-contrast: var(--ay-accent-contrast, light-dark(#ffffff, #17140f));
		--_danger: var(--ay-danger, light-dark(#c0492e, #e88a72));
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

	input:not([type='checkbox']):not([type='radio']),
	textarea,
	select {
		font: inherit;
		color: var(--_text);
		background: var(--_surface);
		border: 1px solid var(--_border);
		border-radius: var(--_radius);
		padding: 0.45rem 0.65rem;
	}

	input[type='checkbox'],
	input[type='radio'] {
		accent-color: var(--_accent);
		width: 0.9rem;
		height: 0.9rem;
		margin: 0;
		cursor: pointer;
	}

	input[type='checkbox'].switch {
		appearance: none;
		width: 2.1rem;
		height: 1.2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--_text-muted) 38%, var(--_surface));
		position: relative;
		transition: background 0.15s ease;
		flex-shrink: 0;
	}

	input[type='checkbox'].switch::before {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(1.2rem - 4px);
		height: calc(1.2rem - 4px);
		border-radius: 999px;
		background: #ffffff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
		transition: translate 0.15s ease;
	}

	input[type='checkbox'].switch:checked {
		background: var(--_accent);
	}

	input[type='checkbox'].switch:checked::before {
		translate: 0.9rem 0;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--_accent);
		outline-offset: 1px;
	}
`;
