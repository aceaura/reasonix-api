/**
 * Stable internal engine contract.
 *
 * This file defines the ONLY types the rest of the app is allowed to depend on
 * when talking to the underlying model engine (reasonix → DeepSeek). Nothing here
 * imports "reasonix". The concrete mapping lives in `./adapter.ts`, which is the
 * single place coupled to the reasonix package.
 *
 * Upgrade contract: when bumping the `reasonix` dependency, only `./adapter.ts`
 * (and possibly `./messages.ts`) should need changes. The contract test suite
 * (`tests/contract`) pins the reasonix surface these adapters rely on.
 */

export type ReasoningEffort = "low" | "medium" | "high" | "max";

/** Normalized chat message (OpenAI-shaped, provider-agnostic). */
export interface EngineMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: EngineToolCall[];
	/** DeepSeek thinking-mode round-trips reasoning back on continuations. */
	reasoning_content?: string | null;
}

export interface EngineToolCall {
	id?: string;
	type?: "function";
	function: { name: string; arguments: string };
}

/** Normalized tool definition. */
export interface EngineTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: Record<string, unknown>;
	};
}

/** Normalized chat request — the only shape callers build. */
export interface EngineChatRequest {
	model: string;
	messages: EngineMessage[];
	tools?: EngineTool[];
	toolChoice?: unknown;
	temperature?: number;
	maxTokens?: number;
	reasoningEffort?: ReasoningEffort;
	responseFormat?: { type: "json_object" | "text" };
	/**
	 * Params reasonix's ChatRequestOptions does NOT model (seed, stop, top_p,
	 * penalties). The adapter merges these into the raw outgoing DeepSeek body.
	 * Keeping them here (rather than dropping them) is the BUG-1 fix done right.
	 */
	extraBody?: Record<string, unknown>;
	signal?: AbortSignal;
}

/** Normalized token usage — cache fields are first-class (the whole point). */
export interface EngineUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedHitTokens: number;
	cachedMissTokens: number;
}

export const EMPTY_USAGE: EngineUsage = {
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedHitTokens: 0,
	cachedMissTokens: 0,
};

export type FinishReason =
	| "stop"
	| "length"
	| "tool_calls"
	| "content_filter"
	| null;

/** Non-streaming result. */
export interface EngineResult {
	content: string;
	reasoning?: string | null;
	toolCalls: EngineToolCall[];
	usage: EngineUsage;
	finishReason: FinishReason;
}

/** One streamed delta. */
export interface EngineStreamChunk {
	contentDelta?: string;
	reasoningDelta?: string;
	toolCallDelta?: {
		index: number;
		id?: string;
		name?: string;
		argumentsDelta?: string;
	};
	usage?: EngineUsage;
	finishReason?: FinishReason;
}

/**
 * The stable engine the app codes against.
 * `chat`/`stream` are the entire coupling surface to the model provider.
 */
export interface ReasonixEngine {
	/** Version string of the underlying reasonix package (diagnostics / headers). */
	readonly reasonixVersion: string;
	chat(req: EngineChatRequest): Promise<EngineResult>;
	stream(req: EngineChatRequest): AsyncIterable<EngineStreamChunk>;
}
