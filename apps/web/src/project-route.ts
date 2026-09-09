import type { ProjectMeta } from '@aylith/tickets-core/client';

export const projectKey = (project: ProjectMeta): string => project.id ?? project.name;
export const projectHref = (project: ProjectMeta): string => `/${encodeURIComponent(projectKey(project))}`;

export type ProjectRoute =
	| { kind: 'all' }
	| { kind: 'project'; project: ProjectMeta }
	| { kind: 'error'; message: string };

/** IDs are authoritative; legacy names remain a read-compatible entry point. */
export function resolveProjectRoute(pathname: string, projects: ProjectMeta[]): ProjectRoute {
	let key: string;
	try {
		key = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ''));
	} catch {
		return { kind: 'error', message: 'Invalid project URL' };
	}
	if (!key) return { kind: 'all' };
	const byId = projects.find((project) => project.id === key);
	if (byId) return { kind: 'project', project: byId };
	const byName = projects.filter((project) => project.name === key);
	if (byName.length === 1 && byName[0]) return { kind: 'project', project: byName[0] };
	return {
		kind: 'error',
		message: byName.length > 1 ? 'Ambiguous project name; use a project ID' : 'Project not found',
	};
}
