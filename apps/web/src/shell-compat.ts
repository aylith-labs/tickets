/**
 * The optional shell is not required to build or run Tickets. Keep the small
 * host boundary local so a Tickets checkout does not depend on the private
 * sibling shell repository being present at install time.
 *
 * The remote's contractVersion is checked before mounting; incompatible
 * remotes leave the native Tickets navigation available. This host-only subset
 * matches aylith-shell packages/contracts at 208a8d14b191d6925f8e281638a6be9202823763.
 */
export const CONTRACT_VERSION = 1 as const;

interface NavigationItem {
	id: string;
	label: string;
	href: string;
	icon?: string;
}

interface ProductDestination {
	id: string;
	name: string;
	href: string;
}

export interface ShellHostContext {
	app: { id: string; name: string };
	location: { pathname: string; title?: string };
	navigation: NavigationItem[];
	products?: ProductDestination[];
	preferencesKey?: string;
	preferences: {
		load(appId: string): Promise<unknown>;
		save(scope: 'global' | 'app', appId: string, profile: unknown, expectedVersion: number): Promise<unknown>;
	};
	onNavigate?(item: NavigationItem): void;
	onEvent?(event: { type: 'ready' | 'preferences-saved' | 'error'; source?: 'remote' | 'preferences' }): void;
}

export interface ShellHandle {
	unmount(): void;
}

export interface ShellRemote {
	contractVersion: typeof CONTRACT_VERSION;
	mount(container: HTMLElement, context: ShellHostContext): Promise<ShellHandle>;
}

/** Only configured HTTPS or local-development destinations can enter the shell. */
export function isShellDestination(href: string): boolean {
	try {
		const url = new URL(href);
		if (url.username || url.password) return false;
		return (
			url.protocol === 'https:' ||
			(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
		);
	} catch {
		return false;
	}
}
