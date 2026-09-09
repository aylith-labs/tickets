import {
	CONTRACT_VERSION,
	isShellDestination,
	type ShellHandle,
	type ShellHostContext,
	type ShellRemote,
} from '@aylith/shell-contract';
import type { TicketsMeta } from '@aylith/tickets-core/client';
import { projectHref, projectKey } from './project-route';

const TRUSTED_MANIFEST = 'http://127.0.0.1:5185/mf-manifest.json';
let stopPrevious: (() => void) | undefined;

/** Optional host-owned HTML configuration, never read from URL parameters or ticket content. */
export async function mountShell(meta: TicketsMeta | null, title: string, restoreTheme: () => void): Promise<void> {
	stopPrevious?.();
	const entry = document.querySelector<HTMLMetaElement>('meta[name="aylith-shell-manifest"]')?.content;
	const enabled = document.querySelector<HTMLMetaElement>('meta[name="aylith-shell-enabled"]')?.content === 'true';
	if (!enabled || !entry) return;
	const controls = document.querySelector<HTMLElement>('#shell-controls');
	const status = document.querySelector<HTMLElement>('#shell-status');
	const button = document.querySelector<HTMLButtonElement>('#shell-toggle');
	if (!controls || !status || !button) return;
	controls.hidden = false;
	// This adoption slice has no deployed remote or authentication configuration.
	if (entry !== TRUSTED_MANIFEST || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
		status.textContent =
			'Shared navigation is not configured for this host. Native project navigation remains available.';
		button.hidden = true;
		return;
	}
	let generation = 0;
	let closed = false;
	let release: (() => void) | undefined;
	let ready = false;
	const stop = () => {
		generation++;
		release?.();
		release = undefined;
		ready = false;
		delete document.body.dataset.shellReady;
		restoreTheme();
		button.disabled = false;
		button.textContent = 'Retry shared navigation';
	};
	const start = async () => {
		stop();
		const attempt = ++generation;
		const current = () => !closed && generation === attempt;
		button.hidden = false;
		button.disabled = true;
		status.textContent = 'Loading optional shared navigation. Local daemon; no shared sign-in.';
		const target = document.createElement('div');
		target.className = 'aylith-shell-mount';
		document.body.append(target);
		let handle: ShellHandle | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const dispose = () => {
			const owned = handle;
			handle = undefined;
			clearTimeout(timer);
			try {
				owned?.unmount();
			} catch (error) {
				console.warn('[Tickets] Optional shell cleanup failed.', error);
			}
			target.remove();
		};
		release = dispose;
		const fail = () => {
			if (!current()) return;
			stop();
			status.textContent = 'Shared navigation unavailable. Native project navigation remains available.';
		};
		const products: NonNullable<ShellHostContext['products']> = [
			{ id: 'tickets', name: 'Tickets', href: location.origin },
		];
		const dashcam = document.querySelector<HTMLMetaElement>('meta[name="aylith-dashcam-url"]')?.content;
		if (dashcam && isShellDestination(dashcam)) products.push({ id: 'dashcam', name: 'Dashcam', href: dashcam });
		const context: ShellHostContext = {
			app: { id: 'tickets', name: 'Tickets' },
			location: { pathname: location.pathname, title },
			navigation: [
				{ id: 'all', label: 'All projects', href: '/', icon: 'home' },
				...(meta?.projects ?? []).map((project) => ({
					id: projectKey(project),
					label: project.name,
					href: projectHref(project),
					icon: 'grid',
				})),
			],
			products,
			preferencesKey: 'tickets-unconnected',
			preferences: {
				async load() {
					throw new Error('Shared preferences require a verified account connection.');
				},
				async save() {
					throw new Error('Shared preferences require a verified account connection.');
				},
			},
			onNavigate(item) {
				if (!current() || !context.navigation.some((link) => link.href === item.href)) return;
				const url = new URL(item.href, location.origin);
				if (url.origin === location.origin) location.assign(url.href);
			},
			onEvent(event) {
				if (event.type === 'error' && event.source === 'remote') fail();
			},
		};
		try {
			await Promise.race([
				(async () => {
					const { createInstance } = await import('@module-federation/runtime');
					if (!current()) return;
					const runtime = createInstance({
						name: 'tickets_host',
						remotes: [{ name: 'aylith_shell', entry }],
						shareStrategy: 'loaded-first',
					});
					const module = await runtime.loadRemote<ShellRemote & { default?: ShellRemote }>('aylith_shell/shell');
					if (!current()) return;
					const remote = module?.default ?? module;
					if (!remote || remote.contractVersion !== CONTRACT_VERSION) throw new Error('Unsupported shell contract');
					handle = await remote.mount(target, context);
					if (!current()) {
						dispose();
						return;
					}
					restoreTheme();
					ready = true;
					document.body.dataset.shellReady = 'true';
					status.textContent = 'Shared navigation enabled. Local daemon; shared preferences are not connected.';
					button.textContent = 'Use native navigation';
				})(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error('Shell mounting timed out')), 8000);
				}),
			]);
		} catch (error) {
			fail();
			console.warn('[Tickets] Optional shell unavailable; native project navigation retained.', error);
		} finally {
			clearTimeout(timer);
			if (current()) button.disabled = false;
		}
	};
	const toggle = () => {
		if (ready) {
			stop();
			status.textContent = 'Using native project navigation. Local daemon; no shared sign-in.';
		} else void start();
	};
	const resume = (event: PageTransitionEvent) => {
		if (event.persisted) void start();
	};
	button.addEventListener('click', toggle);
	window.addEventListener('pagehide', stop);
	window.addEventListener('pageshow', resume);
	stopPrevious = () => {
		closed = true;
		stop();
		button.removeEventListener('click', toggle);
		window.removeEventListener('pagehide', stop);
		window.removeEventListener('pageshow', resume);
		controls.hidden = true;
	};
	await start();
}
