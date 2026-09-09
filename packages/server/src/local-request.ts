/**
 * Browser request boundary for the explicit, auth-less loopback daemon.
 * This is not user/tenant authentication: a native local client can send headers.
 * Forwarded headers never authorize a named host or a different browser origin.
 */
export const allowsLocalRequest = (request: Request, port: number | undefined): boolean => {
	if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) return false;
	const url = new URL(request.url);
	const expectedPort = port === 80 ? '' : String(port);
	if (
		url.protocol !== 'http:' ||
		!['127.0.0.1', 'localhost'].includes(url.hostname) ||
		url.port !== expectedPort ||
		request.headers.get('host') !== url.host
	)
		return false;

	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) return false;
	const site = request.headers.get('sec-fetch-site');
	if (site === null || site === 'same-origin') return true;

	const read = request.method === 'GET' || request.method === 'HEAD';
	if (site === 'none') return read;
	let pathname: string;
	try {
		// Hono decodes escaped path characters before matching API routes.
		pathname = decodeURI(url.pathname);
	} catch {
		return false;
	}
	// A user may follow a link from another app into the UI. That exception is
	// navigation only, never cross-origin API reads, form writes or embedding.
	return (
		read &&
		origin === null &&
		(site === 'same-site' || site === 'cross-site') &&
		request.headers.get('sec-fetch-mode') === 'navigate' &&
		request.headers.get('sec-fetch-dest') === 'document' &&
		!/^\/api(?:\/|$|%)/i.test(pathname)
	);
};
