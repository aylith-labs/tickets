import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTicket, serializeTicket } from './markdown';
import type { Ticket } from './types/Ticket';

export type IncidentScope = { tenantId: string; sourceInstanceId: string; appId: string };
export type IncidentInput = {
	id: string;
	scope: IncidentScope;
	eventId: string;
	fingerprint: string;
	firstSeen: number;
	lastSeen: number;
};
export type IncidentProvenance = {
	schemaVersion: 1;
	projectId: string;
	hubOrigin: string;
	incident: IncidentInput;
};

export class IncidentPersistenceError extends Error {
	constructor(public readonly code: 'provenance_conflict' | 'unsupported_source_version' | 'invalid_source') {
		super(code);
	}
}

export const isIncidentRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
export const hasIncidentKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
	Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const isIncidentIdentifier = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
export const isIncidentUuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const isIncidentScope = (value: unknown): value is IncidentScope =>
	isIncidentRecord(value) &&
	hasIncidentKeys(value, ['tenantId', 'sourceInstanceId', 'appId']) &&
	[value.tenantId, value.sourceInstanceId, value.appId].every(isIncidentIdentifier);
export const incidentScopeKey = (scope: IncidentScope): string =>
	JSON.stringify([scope.tenantId, scope.sourceInstanceId, scope.appId]);
const isEpoch = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
export const isIncidentInput = (value: unknown): value is IncidentInput =>
	isIncidentRecord(value) &&
	hasIncidentKeys(value, ['id', 'scope', 'eventId', 'fingerprint', 'firstSeen', 'lastSeen']) &&
	isIncidentUuid(value.id) &&
	isIncidentScope(value.scope) &&
	isIncidentIdentifier(value.eventId) &&
	typeof value.fingerprint === 'string' &&
	/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,199}$/.test(value.fingerprint) &&
	isEpoch(value.firstSeen) &&
	isEpoch(value.lastSeen) &&
	value.lastSeen >= value.firstSeen;

/** Fixed 15-digit safe integer. Collisions deny explicitly; never choose a second path. */
export const incidentTicketId = (projectId: string, scope: IncidentScope, incidentId: string): string => {
	const key = JSON.stringify(['hub-incident-v1', projectId, incidentScopeKey(scope), incidentId]);
	return String(100_000_000_000_000 + Number.parseInt(createHash('sha256').update(key).digest('hex').slice(0, 12), 16));
};

type Target = { dataDir: string; projectId: string; scope: IncidentScope; incidentId: string; hubOrigin: string };
const hasCode = (error: unknown, code: string): boolean => isIncidentRecord(error) && error.code === code;

/** Read only the deterministic native file; an absent record is different from unreadable/corrupt data. */
export const readIncidentTicket = (target: Target, incident?: IncidentInput): Ticket | null => {
	const id = incidentTicketId(target.projectId, target.scope, target.incidentId);
	const path = join(target.dataDir, 'tickets', `${id}.md`);
	let raw: string;
	try {
		const info = lstatSync(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576)
			throw new IncidentPersistenceError('invalid_source');
		raw = readFileSync(path, 'utf8');
	} catch (error) {
		if (hasCode(error, 'ENOENT')) return null;
		throw error;
	}
	let ticket: Ticket;
	try {
		ticket = parseTicket(raw);
	} catch {
		throw new IncidentPersistenceError('invalid_source');
	}
	const provenance = ticket.incidentProvenance;
	if (isIncidentRecord(provenance) && Object.hasOwn(provenance, 'schemaVersion') && provenance.schemaVersion !== 1) {
		throw new IncidentPersistenceError('unsupported_source_version');
	}
	if (
		!isIncidentRecord(provenance) ||
		!hasIncidentKeys(provenance, ['schemaVersion', 'projectId', 'hubOrigin', 'incident']) ||
		provenance.schemaVersion !== 1 ||
		provenance.projectId !== target.projectId ||
		provenance.hubOrigin !== target.hubOrigin ||
		!isIncidentInput(provenance.incident) ||
		provenance.incident.id !== target.incidentId ||
		incidentScopeKey(provenance.incident.scope) !== incidentScopeKey(target.scope) ||
		(incident &&
			(provenance.incident.fingerprint !== incident.fingerprint ||
				provenance.incident.firstSeen !== incident.firstSeen))
	)
		throw new IncidentPersistenceError('provenance_conflict');
	if (
		ticket.id !== id ||
		!ticket.title.trim() ||
		ticket.title.length > 10000 ||
		!ticket.status.trim() ||
		ticket.status.length > 1000 ||
		!Number.isFinite(Date.parse(ticket.created))
	)
		throw new IncidentPersistenceError('invalid_source');
	return ticket;
};

/**
 * Publish complete native Markdown + provenance in one exclusive hard-link operation.
 * A process death before link leaves only an ignored .tmp; after link, retries find
 * the complete ticket. No lock, in-memory dedup, receipt sidecar or overwrite fallback.
 * Host power-loss/directory-journal durability is outside this process-restart guarantee.
 * The caller supplies a synchronous fresh authority/mapping guard at the commit point.
 */
export const createIncidentTicket = (
	target: Target,
	incident: IncidentInput,
	status: string,
	beforeCommit: () => void,
): { ticket: Ticket; duplicate: boolean } => {
	const existing = readIncidentTicket(target, incident);
	if (existing) return { ticket: existing, duplicate: true };
	const id = incidentTicketId(target.projectId, target.scope, target.incidentId);
	const provenance: IncidentProvenance = {
		schemaVersion: 1,
		projectId: target.projectId,
		hubOrigin: target.hubOrigin,
		incident,
	};
	const ticket: Ticket = {
		id,
		title: `${incident.scope.appId}: ${incident.fingerprint}`,
		status,
		archived: false,
		created: new Date().toISOString(),
		attachments: [],
		incidentProvenance: provenance,
		description: [
			`Triage the private Hub incident for ${incident.scope.appId}.`,
			`Fingerprint: ${incident.fingerprint}`,
			`Source event: ${incident.eventId}`,
			`First seen: ${new Date(incident.firstSeen).toISOString()}`,
			`Last seen at triage: ${new Date(incident.lastSeen).toISOString()}`,
			`[Open source incident](${target.hubOrigin}/?incident=${incident.id})`,
		].join('\n\n'),
	};
	const path = join(target.dataDir, 'tickets', `${id}.md`);
	const staged = join(target.dataDir, 'tickets', `.incident-${randomUUID()}.tmp`);
	const descriptor = openSync(staged, 'wx', 0o600);
	try {
		try {
			writeFileSync(descriptor, serializeTicket(ticket), 'utf8');
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
		beforeCommit();
		try {
			linkSync(staged, path);
		} catch (error) {
			if (!hasCode(error, 'EEXIST')) throw error;
			const winner = readIncidentTicket(target, incident);
			if (!winner) throw new IncidentPersistenceError('invalid_source');
			return { ticket: winner, duplicate: true };
		}
		return { ticket, duplicate: false };
	} finally {
		// Only our exact random staging path; failed cleanup is harmless and never authorizes a retry overwrite.
		try {
			unlinkSync(staged);
		} catch {
			/* Retain an ignored staging artifact on cleanup failure. */
		}
	}
};
