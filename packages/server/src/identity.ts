/** A stable 12-hex project id — immutable once minted, independent of name/path/topology. */
export const generateProjectId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/** Filesystem-safe cosmetic slug of a display name (the id, not the slug, is authoritative). */
export const slugifyProjectName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'project';

/** Store folder name: human-browsable slug + short id, so it stays unique and rename-safe. */
export const projectSubdir = (id: string, name: string): string => `${slugifyProjectName(name)}-${id.slice(0, 6)}`;
