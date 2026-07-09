import type { EnrichResult } from './EnrichResult';

const asEnrichResult = (value: unknown): EnrichResult | null => {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.title !== 'string' || typeof record.description !== 'string') return null;
	if (record.title.trim().length === 0) return null;
	return { title: record.title.trim(), description: record.description.trim() };
};

/** Tolerant extraction: direct JSON, fenced ```json blocks, or the first {...} span. */
export const extractEnrichResult = (text: string): EnrichResult | null => {
	const candidates: string[] = [text.trim()];
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced?.[1]) candidates.push(fenced[1].trim());
	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

	for (const candidate of candidates) {
		try {
			const result = asEnrichResult(JSON.parse(candidate));
			if (result) return result;
		} catch {
			// try the next candidate shape
		}
	}
	return null;
};
