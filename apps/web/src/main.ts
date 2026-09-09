import { type ProjectMeta, TicketsClient, type TicketsMeta } from '@aylith/tickets-ui';
import { projectHref, projectKey, resolveProjectRoute } from './project-route';
import { mountShell } from './shell-host';
import { readTicketRoute } from './ticket-route';

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

const initTheme = (): (() => void) => {
	let theme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';
	if (!THEMES.includes(theme)) theme = 'system';
	applyTheme(theme);
	document.querySelector('#theme-toggle')?.addEventListener('click', () => {
		theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'system';
		localStorage.setItem(THEME_KEY, theme);
		applyTheme(theme);
	});
	return () => applyTheme(theme);
};

const locationSummary = (project: ProjectMeta): string => {
	const { location } = project;
	const parts = [`${location.kind}/${location.scope}`, location.dataDir];
	if (location.branch) parts.push(`branch ${location.branch}`);
	if (location.remote) parts.push(location.remote);
	if (location.kind === 'git') parts.push(location.pushEnabled ? 'push on' : 'push off');
	return parts.join(' · ');
};

const makeChip = (label: string, href: string, active: boolean): HTMLAnchorElement => {
	const anchor = document.createElement('a');
	anchor.className = `chip${active ? ' active' : ''}`;
	anchor.href = href;
	anchor.textContent = label;
	return anchor;
};

const renderProjectChips = (meta: TicketsMeta | null, activeProject: string): void => {
	const nav = document.querySelector('#projects');
	if (!nav || !meta) return;
	const chips = [makeChip('all', '/', activeProject === '')];
	for (const project of meta.projects) {
		const chip = makeChip(project.name, projectHref(project), projectKey(project) === activeProject);
		chip.title = project.unavailable
			? `${locationSummary(project)} · unavailable: ${project.unavailable}`
			: locationSummary(project);
		if (project.location.scope === 'central') {
			const glyph = document.createElement('span');
			glyph.className = 'scope';
			glyph.textContent = '⌂';
			chip.append(glyph);
		}
		chips.push(chip);
	}
	nav.replaceChildren(...chips);
};

const renderProjectInfo = (meta: TicketsMeta | null, activeProject: string): void => {
	const info = document.querySelector('#project-info');
	if (!info) return;
	if (!meta) {
		info.replaceChildren();
		return;
	}
	if (activeProject === '') {
		info.textContent = `all projects · store: ${meta.storeRoots.store} · worktrees: ${meta.storeRoots.worktrees}`;
		return;
	}
	const project = meta.projects.find((entry) => projectKey(entry) === activeProject);
	if (!project) {
		info.replaceChildren();
		return;
	}
	info.textContent = locationSummary(project);
	if (project.unavailable) {
		const warn = document.createElement('span');
		warn.className = 'warn';
		warn.textContent = ` · unavailable: ${project.unavailable}`;
		info.append(warn);
	}
};

const main = async (): Promise<void> => {
	const restoreTheme = initTheme();
	const meta = await new TicketsClient(API_BASE).meta().catch(() => null);
	const route = resolveProjectRoute(location.pathname, meta?.projects ?? []);
	const ticketRoute = readTicketRoute(location.search);
	const ticketError =
		ticketRoute.error ||
		(ticketRoute.id && (route.kind !== 'project' || !route.project.id)
			? 'Open this ticket through its stable project URL.'
			: undefined);
	if (!meta || route.kind === 'error' || ticketError) {
		const message = document.createElement('p');
		message.setAttribute('role', 'alert');
		message.textContent = !meta
			? 'Cannot reach the tickets daemon. Reload to retry.'
			: route.kind === 'error'
				? route.message
				: (ticketError ?? '');
		const home = makeChip('All projects', '/', false);
		document.querySelector('#app')?.replaceChildren(message, home);
		renderProjectChips(meta, '');
		void mountShell(meta, 'Project unavailable', restoreTheme);
		return;
	}
	const project = route.kind === 'project' ? projectKey(route.project) : '';
	if (route.kind === 'project' && location.pathname !== projectHref(route.project)) {
		history.replaceState(null, '', `${projectHref(route.project)}${location.search}${location.hash}`);
	}
	renderProjectChips(meta, project);
	renderProjectInfo(meta, project);
	const list = document.createElement('ay-ticket-list');
	list.setAttribute('api-base', API_BASE);
	if (project) list.setAttribute('project', project);
	if (ticketRoute.id) list.setAttribute('ticket-id', ticketRoute.id);
	document.querySelector('#app')?.append(list);
	void mountShell(meta, route.kind === 'project' ? route.project.name : 'All projects', restoreTheme);
	// The docked split wants the whole viewport — drop the shell's width cap while active.
	document.addEventListener('ay-dock-change', (event) => {
		const split = Boolean((event as CustomEvent<{ split?: boolean }>).detail?.split);
		document.querySelector('.shell')?.classList.toggle('wide', split);
	});
};

void main();
