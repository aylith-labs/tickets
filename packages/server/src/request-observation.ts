import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/** Source-owned labels for finite native routes. No request-derived dimensions. */
export const TICKETS_OBSERVED_ROUTES = Object.freeze([
	Object.freeze({ path: '/api/projects', method: 'GET', id: 'tickets-projects' } as const),
	Object.freeze({ path: '/api/tickets', method: 'GET', id: 'tickets-list' } as const),
	Object.freeze({ path: '/api/tickets/:project/:id', method: 'GET', id: 'tickets-detail' } as const),
	Object.freeze({ path: '/api/tickets', method: 'POST', id: 'tickets-create' } as const),
	Object.freeze({ path: '/api/tickets/:project/:id', method: 'PATCH', id: 'tickets-update' } as const),
]);

type ObservedRoute = (typeof TICKETS_OBSERVED_ROUTES)[number];
export type TicketsRequestObservation = Readonly<{
	schemaVersion: 1;
	kind: 'request';
	eventId: string;
	occurredAt: number;
	routeId: ObservedRoute['id'];
	method: ObservedRoute['method'];
	status: number;
	durationMs: number;
}>;

/** Synchronous enqueue only. The trusted host owns delivery, grants and fixed scope. */
export type TicketsObservationSink = (event: TicketsRequestObservation) => boolean;
export type TicketsRequestObserver = {
	middleware: MiddlewareHandler;
	snapshot: () => { active: boolean; accepted: number; dropped: number };
	/** Stops new and in-flight observations; does not cancel native requests or drain a host sender. */
	close: () => void;
};

const selectRoute = (url: string, method: string): ObservedRoute | undefined => {
	if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') return;
	// Hono decodes some escapes in req.path. Inspect the URL pathname before decoding
	// so encoded aliases never acquire a native route label. Query/fragment are ignored.
	const path = new URL(url).pathname;
	if (path.includes('%')) return;
	const routePath = /^\/api\/tickets\/[^/\\]+\/[^/\\]+$/.test(path) ? '/api/tickets/:project/:id' : path;
	return TICKETS_OBSERVED_ROUTES.find((route) => route.method === method && route.path === routePath);
};

/** Opt-in only: no network, queue, timer or background worker. Register before native routes. */
export function createRequestObservation(sink: TicketsObservationSink): TicketsRequestObserver {
	let active = true;
	let accepted = 0;
	let dropped = 0;
	const middleware: MiddlewareHandler = async (context, next) => {
		if (!active) return next();
		const route = selectRoute(context.req.raw.url, context.req.raw.method);
		if (!route) return next();
		const start = performance.now();
		let threw = false;
		try {
			await next();
		} catch (error) {
			threw = true;
			throw error;
		} finally {
			if (active) {
				try {
					const elapsed = performance.now() - start;
					const event: TicketsRequestObservation = Object.freeze({
						schemaVersion: 1,
						kind: 'request',
						eventId: randomUUID(),
						occurredAt: Date.now(),
						routeId: route.id,
						method: route.method,
						// Hono normally handles thrown errors inside next(), finalizing its
						// error response first. Preserve that actual status, including 5xx.
						status: threw ? 500 : context.res.status,
						durationMs: Number.isFinite(elapsed) ? Math.min(60_000, Math.max(0, Math.round(elapsed))) : 0,
					});
					const result: unknown = sink(event);
					if (result === true) accepted++;
					else {
						dropped++;
						// Async sinks are a contract violation, never awaited or accepted.
						// Consume accidental promise/thenable rejection without retaining it.
						if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
							void Promise.resolve(result).catch(() => {});
						}
					}
				} catch {
					dropped++;
				}
			}
		}
	};
	return {
		middleware,
		snapshot: () => ({ active, accepted, dropped }),
		close: () => {
			active = false;
		},
	};
}
