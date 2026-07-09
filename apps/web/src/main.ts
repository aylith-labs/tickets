import { TicketsClient } from '@aylith/tickets-ui';

const API_BASE = '/api';
const THEME_KEY = 'ay-theme';
const THEMES = ['system', 'light', 'dark'] as const;

type Theme = (typeof THEMES)[number];

const applyTheme = (theme: Theme): void => {
	if (theme === 'system') delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
	if (toggle) toggle.textContent = `theme: ${theme}`;
};

const initTheme = (): void => {
	let theme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';
	if (!THEMES.includes(theme)) theme = 'system';
	applyTheme(theme);
	document.querySelector('#theme-toggle')?.addEventListener('click', () => {
		theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'system';
		localStorage.setItem(THEME_KEY, theme);
		applyTheme(theme);
	});
};

const renderProjectChips = async (activeProject: string): Promise<void> => {
	const nav = document.querySelector('#projects');
	if (!nav) return;
	const meta = await new TicketsClient(API_BASE).meta().catch(() => null);
	if (!meta) return;
	const chips = [
		{ label: 'all', href: '/', active: activeProject === '' },
		...meta.projects.map((project) => ({
			label: project.name,
			href: `/${encodeURIComponent(project.name)}`,
			active: project.name === activeProject,
		})),
	];
	nav.replaceChildren(
		...chips.map(({ label, href, active }) => {
			const anchor = document.createElement('a');
			anchor.className = `chip${active ? ' active' : ''}`;
			anchor.href = href;
			anchor.textContent = label;
			return anchor;
		}),
	);
};

const main = (): void => {
	initTheme();
	const project = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''));
	void renderProjectChips(project);
	const list = document.createElement('ay-ticket-list');
	list.setAttribute('api-base', API_BASE);
	if (project) list.setAttribute('project', project);
	document.querySelector('#app')?.append(list);
};

main();
