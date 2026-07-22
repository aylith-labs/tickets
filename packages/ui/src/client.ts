// The isomorphic subpath — never pulls core's Node-only storage adapters into
// the browser bundle.
export {
	type ProjectMeta,
	TicketsClient,
	type TicketsMeta,
	type TicketWithProject,
} from '@aylith/tickets-core/client';
