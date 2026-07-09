import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import type { Ticket } from '@aylith/tickets-core';
import type { EnrichProviderConfig } from '../types/EnrichProviderConfig';
import type { EnrichResult } from './EnrichResult';
import { extractEnrichResult } from './json';
import { buildEnrichPrompt, ENRICH_SCHEMA } from './prompt';

const execFileAsync = promisify(execFile);

const ENRICH_TIMEOUT_MS = 180_000;

const resolveApiKey = (config: EnrichProviderConfig): string | undefined =>
	config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;

/** Headless Claude Code CLI — uses the host's subscription auth, no key management. */
const enrichWithClaudeCli = async (prompt: string, config: EnrichProviderConfig): Promise<EnrichResult | null> => {
	const args = ['-p', prompt];
	if (config.model) args.push('--model', config.model);
	const { stdout } = await execFileAsync('claude', args, { timeout: ENRICH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
	return extractEnrichResult(stdout);
};

const enrichWithAnthropic = async (prompt: string, config: EnrichProviderConfig): Promise<EnrichResult | null> => {
	const client = new Anthropic({ apiKey: resolveApiKey(config) });
	const response = await client.messages.create({
		model: config.model ?? 'claude-opus-4-8',
		max_tokens: 16000,
		output_config: { format: { type: 'json_schema', schema: ENRICH_SCHEMA } },
		messages: [{ role: 'user', content: prompt }],
	});
	const textBlock = response.content.find((block) => block.type === 'text');
	return textBlock ? extractEnrichResult(textBlock.text) : null;
};

/** Any /chat/completions endpoint — covers Ollama, LM Studio, vLLM, etc. */
const enrichWithOpenAiCompatible = async (
	prompt: string,
	config: EnrichProviderConfig,
): Promise<EnrichResult | null> => {
	if (!config.baseUrl) throw new Error(`Provider ${config.id} needs a baseUrl`);
	const apiKey = resolveApiKey(config);
	const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
		},
		body: JSON.stringify({
			model: config.model,
			messages: [{ role: 'user', content: prompt }],
			response_format: { type: 'json_object' },
		}),
		signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Provider ${config.id} responded ${response.status}: ${await response.text()}`);
	const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
	const content = payload.choices?.[0]?.message?.content;
	return typeof content === 'string' ? extractEnrichResult(content) : null;
};

export const enrichTicket = async (ticket: Ticket, config: EnrichProviderConfig): Promise<EnrichResult> => {
	const prompt = buildEnrichPrompt(ticket);
	let result: EnrichResult | null;
	switch (config.kind) {
		case 'claude-cli':
			result = await enrichWithClaudeCli(prompt, config);
			break;
		case 'anthropic':
			result = await enrichWithAnthropic(prompt, config);
			break;
		case 'openai-compatible':
			result = await enrichWithOpenAiCompatible(prompt, config);
			break;
		default:
			throw new Error(`Unknown enrich provider kind ${config.kind}`);
	}
	if (!result) throw new Error(`Provider ${config.id} returned no usable {title, description} JSON`);
	return result;
};
