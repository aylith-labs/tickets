import { expect, test } from 'bun:test';
import { incidentSource } from './incident-source';

const source = {
	schemaVersion: 1,
	projectId: 'exact-project',
	hubOrigin: 'http://127.0.0.1:34001',
	incident: { id: '12345678-1234-1234-1234-123456789abc' },
};
test('only known source version and exact project project a credential-free local backlink', () => {
	expect(incidentSource(source, 'exact-project')).toEqual({
		state: 'linked',
		href: `${source.hubOrigin}/?incident=${source.incident.id}`,
	});
	expect(incidentSource(undefined, 'exact-project').state).toBe('absent');
	for (const changed of [
		{ schemaVersion: 2 },
		{ projectId: 'other' },
		{ hubOrigin: 'https://example.com' },
		{ hubOrigin: 'http://user:secret@127.0.0.1:34001' },
		{ hubOrigin: source.hubOrigin + '/?token=private' },
		{ incident: { id: '../../escape' } },
	]) {
		expect(incidentSource({ ...source, ...changed }, 'exact-project').state).toBe('unsupported');
	}
	expect(incidentSource(source, undefined).state).toBe('unsupported');
});
