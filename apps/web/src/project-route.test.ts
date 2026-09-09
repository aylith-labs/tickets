import { describe, expect, test } from 'bun:test';
import type { ProjectMeta } from '@aylith/tickets-core/client';
import { projectHref, resolveProjectRoute } from './project-route';

const project: ProjectMeta = {
	id: 'stable-1',
	name: 'renamed / project',
	repoPath: '/synthetic',
	adapter: 'folder',
	location: { kind: 'folder', scope: 'repo', dataDir: '/synthetic' },
};

describe('project routing identity', () => {
	test('ID survives rename and drives generated link', () => {
		expect(projectHref(project)).toBe('/stable-1');
		expect(resolveProjectRoute('/stable-1', [project])).toEqual({ kind: 'project', project });
	});
	test('legacy names remain accepted and encoded', () => {
		expect(resolveProjectRoute('/renamed%20%2F%20project', [project])).toEqual({ kind: 'project', project });
		expect(projectHref({ ...project, id: undefined })).toBe('/renamed%20%2F%20project');
	});
	test('invalid and unknown paths never become all-project scope', () => {
		expect(resolveProjectRoute('/%E0%A4%A', [project]).kind).toBe('error');
		expect(resolveProjectRoute('/missing', [project]).kind).toBe('error');
		expect(resolveProjectRoute('/', [project])).toEqual({ kind: 'all' });
	});
	test('ID takes precedence; duplicate legacy names require explicit identity', () => {
		const other = { ...project, id: 'stable-2', name: 'stable-1' };
		expect(resolveProjectRoute('/stable-1', [other, project])).toEqual({ kind: 'project', project });
		expect(resolveProjectRoute('/renamed%20%2F%20project', [project, { ...project, id: 'stable-3' }]).kind).toBe(
			'error',
		);
	});
});
