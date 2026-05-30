import type { ServerConfig } from "./types.js";

/**
 * Default model mapping: OpenAI model names -> DeepSeek model names.
 * Can be overridden via environment variables.
 */
// Targets must be REAL DeepSeek API models. The public API serves exactly two:
//   - deepseek-chat     (V3, non-thinking)
//   - deepseek-reasoner (R1, thinking)
// Unmapped model ids pass through unchanged (see mapModel), so any real DeepSeek
// id — including dated snapshots — works without being listed here.
export const DEFAULT_MODEL_MAP: Record<string, string> = {
	// OpenAI aliases → deepseek-chat (general-purpose default)
	"gpt-4o": "deepseek-chat",
	"gpt-4o-mini": "deepseek-chat",
	"gpt-4-turbo": "deepseek-chat",
	"gpt-4": "deepseek-chat",
	"gpt-3.5-turbo": "deepseek-chat",
	"gpt-3.5-turbo-16k": "deepseek-chat",
	// OpenAI reasoning aliases → deepseek-reasoner (thinking)
	o1: "deepseek-reasoner",
	"o1-mini": "deepseek-reasoner",
	"o3-mini": "deepseek-reasoner",
	// DeepSeek native (identity / friendly aliases)
	"deepseek-chat": "deepseek-chat",
	"deepseek-reasoner": "deepseek-reasoner",
	"deepseek-coder": "deepseek-chat",
	"deepseek-v3": "deepseek-chat",
	"deepseek-r1": "deepseek-reasoner",
	// Generic fallback
	default: "deepseek-chat",
};

export interface ClientFactoryOptions {
	deepseekApiKey: string;
	deepseekBaseUrl?: string;
	defaultModel?: string;
	modelMapping?: Record<string, string>;
	reasoningEffort?: "low" | "medium" | "high" | "max";
	maxOutputTokens?: number;
	budgetUsd?: number;
	systemPrompt?: string;
	sessionTtlMinutes?: number;
	maxConcurrentSessions?: number;
}

export class ClientFactory {
	private defaultModel: string;
	private modelMapping: Record<string, string>;

	constructor(opts: ClientFactoryOptions) {
		if (!opts.deepseekApiKey) {
			throw new Error("DEEPSEEK_API_KEY is required");
		}
		this.defaultModel = opts.defaultModel ?? "deepseek-chat";
		this.modelMapping = { ...DEFAULT_MODEL_MAP, ...opts.modelMapping };
	}

	/**
	 * Map an OpenAI model name to a DeepSeek model name.
	 */
	mapModel(model: string): string {
		// Check exact match first
		const exact = this.modelMapping[model];
		if (exact !== undefined) return exact;
		// Check prefix match (e.g., "gpt-4o-2024-05-13" -> "gpt-4o")
		const prefix = model.split("-").slice(0, 2).join("-");
		const byPrefix = this.modelMapping[prefix];
		if (byPrefix !== undefined) return byPrefix;
		// Unknown model, pass through
		return model;
	}

	/**
	 * Get the default model name.
	 */
	getDefaultModel(): string {
		return this.defaultModel;
	}

	/**
	 * Get all available (mapped) model names.
	 */
	getAvailableModels(): string[] {
		return Object.keys(this.modelMapping);
	}

	/**
	 * Get all target DeepSeek model names (deduplicated).
	 */
	getDeepSeekModels(): string[] {
		const models = new Set(Object.values(this.modelMapping));
		return Array.from(models);
	}
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let factory: ClientFactory | null = null;

/** Initialize the global ClientFactory from server config. */
export function initClient(config: ServerConfig): ClientFactory {
	factory = new ClientFactory({
		deepseekApiKey: config.deepseekApiKey,
		deepseekBaseUrl: config.deepseekBaseUrl,
		defaultModel: config.defaultModel,
		modelMapping: config.modelMapping,
		maxOutputTokens: config.maxTokens,
		budgetUsd: config.budgetUsd,
	});
	return factory;
}

/** Get the global ClientFactory (must call initClient first). */
export function getFactory(): ClientFactory {
	if (!factory) {
		throw new Error(
			"ClientFactory not initialized. Call initClient(config) first.",
		);
	}
	return factory;
}
