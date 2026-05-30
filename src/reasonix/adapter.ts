/**
 * Reasonix adapter — THE ONLY FILE IN THE APP THAT IMPORTS "reasonix".
 *
 * Maps our stable `ReasonixEngine` contract (./engine.ts) onto reasonix's
 * `DeepSeekClient`. All version-sensitive field mapping is concentrated here.
 *
 * When upgrading reasonix: run `npm run test:contract` first. If it goes red,
 * the only file you should need to touch is this one.
 */
import {
	type ChatMessage,
	type ChatResponse,
	DeepSeekClient,
	VERSION as REASONIX_VERSION,
	type StreamChunk,
	type ToolSpec,
	type Usage,
} from "reasonix";

/**
 * `ChatRequestOptions` is not exported by reasonix, so we derive it from the
 * method signature. This also makes the adapter resilient to additive changes.
 */
type ChatRequestOptions = Parameters<DeepSeekClient["chat"]>[0];
import {
	EMPTY_USAGE,
	type EngineChatRequest,
	type EngineMessage,
	type EngineResult,
	type EngineStreamChunk,
	type EngineTool,
	type EngineToolCall,
	type EngineUsage,
	type FinishReason,
	type ReasonixEngine,
} from "./engine.js";

export interface AdapterOptions {
	apiKey: string;
	baseUrl?: string;
	timeoutMs?: number;
}

const CHAT_PATH = "/chat/completions";

/** Map our normalized usage from reasonix's Usage instance. */
export function mapUsage(u: Usage | undefined | null): EngineUsage {
	if (!u) return { ...EMPTY_USAGE };
	return {
		promptTokens: u.promptTokens ?? 0,
		completionTokens: u.completionTokens ?? 0,
		totalTokens: u.totalTokens ?? 0,
		cachedHitTokens: u.promptCacheHitTokens ?? 0,
		cachedMissTokens: u.promptCacheMissTokens ?? 0,
	};
}

/** Narrow reasonix's free-form finishReason string to our union. */
function mapFinishReason(raw: unknown, hasToolCalls: boolean): FinishReason {
	const r = typeof raw === "string" ? raw : null;
	if (r === "length") return "length";
	if (r === "content_filter") return "content_filter";
	if (r === "tool_calls") return "tool_calls";
	if (r === "stop") return hasToolCalls ? "tool_calls" : "stop";
	// Fallback: infer from presence of tool calls.
	return hasToolCalls ? "tool_calls" : "stop";
}

function toReasonixMessages(messages: EngineMessage[]): ChatMessage[] {
	return messages.map((m) => {
		const out: ChatMessage = { role: m.role };
		if (m.content !== undefined) out.content = m.content;
		if (m.name !== undefined) out.name = m.name;
		if (m.tool_call_id !== undefined) out.tool_call_id = m.tool_call_id;
		if (m.reasoning_content !== undefined)
			out.reasoning_content = m.reasoning_content;
		if (m.tool_calls) {
			out.tool_calls = m.tool_calls.map((tc) => ({
				id: tc.id,
				type: tc.type ?? "function",
				function: { name: tc.function.name, arguments: tc.function.arguments },
			}));
		}
		return out;
	});
}

function toReasonixTools(
	tools: EngineTool[] | undefined,
): ToolSpec[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.function.name,
			description: t.function.description ?? "",
			parameters: t.function.parameters as ToolSpec["function"]["parameters"],
		},
	}));
}

/**
 * Build a fetch wrapper that merges `extraBody` (seed / stop / top_p / penalties —
 * fields reasonix's ChatRequestOptions doesn't model) into the outgoing chat body.
 * This is how unsupported-but-valid OpenAI params reach DeepSeek without forking
 * the reasonix client.
 */
function makeFetch(
	extraBody: Record<string, unknown> | undefined,
): typeof fetch {
	if (!extraBody || Object.keys(extraBody).length === 0) {
		return fetch;
	}
	return (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (
			init?.body &&
			typeof init.body === "string" &&
			url.includes(CHAT_PATH)
		) {
			try {
				const parsed = JSON.parse(init.body) as Record<string, unknown>;
				for (const [k, v] of Object.entries(extraBody)) {
					if (parsed[k] === undefined) parsed[k] = v;
				}
				return fetch(input, { ...init, body: JSON.stringify(parsed) });
			} catch {
				// Body wasn't JSON we could merge — fall through with the original.
			}
		}
		return fetch(input, init);
	};
}

export class ReasonixAdapter implements ReasonixEngine {
	readonly reasonixVersion = REASONIX_VERSION;
	private readonly apiKey: string;
	private readonly baseUrl?: string;
	private readonly timeoutMs: number;

	constructor(opts: AdapterOptions) {
		if (!opts.apiKey) throw new Error("ReasonixAdapter: apiKey is required");
		this.apiKey = opts.apiKey;
		this.baseUrl = opts.baseUrl;
		this.timeoutMs = opts.timeoutMs ?? 660_000;
	}

	/** Build a per-request client so each call's extraBody is isolated (concurrency-safe). */
	private client(extraBody?: Record<string, unknown>): DeepSeekClient {
		return new DeepSeekClient({
			apiKey: this.apiKey,
			baseUrl: this.baseUrl,
			timeoutMs: this.timeoutMs,
			fetch: makeFetch(extraBody),
		});
	}

	private buildOptions(
		req: EngineChatRequest,
		stream: boolean,
	): ChatRequestOptions {
		const opts: ChatRequestOptions = {
			model: req.model,
			messages: toReasonixMessages(req.messages),
			stream,
		};
		const tools = toReasonixTools(req.tools);
		if (tools) opts.tools = tools;
		if (req.temperature !== undefined) opts.temperature = req.temperature;
		if (req.maxTokens !== undefined) opts.maxTokens = req.maxTokens;
		if (req.responseFormat) opts.responseFormat = req.responseFormat;
		if (req.reasoningEffort) opts.reasoningEffort = req.reasoningEffort;
		if (req.signal) opts.signal = req.signal;
		return opts;
	}

	async chat(req: EngineChatRequest): Promise<EngineResult> {
		const client = this.client(req.extraBody);
		const res: ChatResponse = await client.chat(this.buildOptions(req, false));
		const toolCalls = mapToolCalls(res.toolCalls);
		const rawFinish = readRawFinishReason(res.raw);
		return {
			content: res.content ?? "",
			reasoning: res.reasoningContent ?? null,
			toolCalls,
			usage: mapUsage(res.usage),
			finishReason: mapFinishReason(rawFinish, toolCalls.length > 0),
		};
	}

	async *stream(req: EngineChatRequest): AsyncIterable<EngineStreamChunk> {
		const client = this.client(req.extraBody);
		let sawToolCall = false;
		for await (const chunk of client.stream(this.buildOptions(req, true))) {
			const out: EngineStreamChunk = {};
			const c = chunk as StreamChunk;
			if (c.contentDelta) out.contentDelta = c.contentDelta;
			if (c.reasoningDelta) out.reasoningDelta = c.reasoningDelta;
			if (c.toolCallDelta) {
				sawToolCall = true;
				out.toolCallDelta = {
					index: c.toolCallDelta.index,
					id: c.toolCallDelta.id,
					name: c.toolCallDelta.name,
					argumentsDelta: c.toolCallDelta.argumentsDelta,
				};
			}
			if (c.usage) out.usage = mapUsage(c.usage);
			if (c.finishReason !== undefined && c.finishReason !== null) {
				out.finishReason = mapFinishReason(c.finishReason, sawToolCall);
			}
			yield out;
		}
	}
}

function mapToolCalls(
	calls: ChatResponse["toolCalls"] | undefined,
): EngineToolCall[] {
	if (!calls) return [];
	return calls.map((tc) => ({
		id: tc.id,
		type: tc.type ?? "function",
		function: { name: tc.function.name, arguments: tc.function.arguments },
	}));
}

/** Read finish_reason out of the raw DeepSeek response JSON if present. */
function readRawFinishReason(raw: unknown): unknown {
	if (raw && typeof raw === "object") {
		const choices = (raw as { choices?: Array<{ finish_reason?: unknown }> })
			.choices;
		if (Array.isArray(choices) && choices[0]) return choices[0].finish_reason;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Singleton wiring
// ---------------------------------------------------------------------------

let engine: ReasonixEngine | null = null;

export function initEngine(opts: AdapterOptions): ReasonixEngine {
	engine = new ReasonixAdapter(opts);
	return engine;
}

export function getEngine(): ReasonixEngine {
	if (!engine)
		throw new Error("Engine not initialized. Call initEngine() first.");
	return engine;
}

/** Test seam: inject a mock engine. */
export function setEngine(e: ReasonixEngine): void {
	engine = e;
}
