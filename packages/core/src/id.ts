import { ID_PAD_WIDTH } from './constants';

export const nextTicketId = (existingIds: string[]): string => {
	let highest = 0;
	for (const existing of existingIds) {
		const numeric = Number.parseInt(existing, 10);
		if (Number.isFinite(numeric) && numeric > highest) highest = numeric;
	}
	return String(highest + 1).padStart(ID_PAD_WIDTH, '0');
};
