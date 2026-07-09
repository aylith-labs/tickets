export type MediaConfig = {
	/** Local checkout of the media repo uploads are committed to. */
	repoPath: string;
	/** Public base URL the repo is served at, e.g. https://media.aylith.com */
	baseUrl: string;
	/** Path prefix inside the repo's media tree, e.g. "tickets". */
	pathPrefix: string;
	/** Optional publish command run in repoPath after commit+push (e.g. "./sync.sh push"). */
	publishCommand?: string;
};
