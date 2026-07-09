export type EnrichProviderKind = 'claude-cli' | 'anthropic' | 'openai-compatible';

export type EnrichProviderConfig = {
	id: string;
	kind: EnrichProviderKind;
	model?: string;
	/** openai-compatible only, e.g. http://localhost:11434/v1 for Ollama. */
	baseUrl?: string;
	/** Name of the env var holding the API key (never the key itself). */
	apiKeyEnv?: string;
};
