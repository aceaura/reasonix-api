import type {
	EngineResult,
	EngineStreamChunk,
	EngineUsage,
	FinishReason,
} from "../reasonix/engine.js";
/**
 * OpenAI SSE framing + response building, driven by the engine contract
 * (EngineStreamChunk / EngineResult). No coupling to reasonix internals.
 */
import { unixTimestamp } from "./types.js";

// ---------------------------------------------------------------------------
// SSE framing
// ---------------------------------------------------------------------------

export function encodeSSE(data: unknown): string {
	const json = typeof data === "string" ? data : JSON.stringify(data);
	return `data: ${json}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS: Record<string, string> = {
	"Content-Type": "text/event-stream; charset=utf-8",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
	"Transfer-Encoding": "chunked",
};

// ---------------------------------------------------------------------------
// Usage mapping
// ---------------------------------------------------------------------------

export function toOpenAIUsage(u: EngineUsage) {
	return {
		prompt_tokens: u.promptTokens,
		completion_tokens: u.completionTokens,
		total_tokens: u.totalTokens,
		prompt_tokens_details: { cached_tokens: u.cachedHitTokens },
	};
}

interface ChunkOpts {
	completionId: string;
	model: string;
	includeUsage?: boolean;
}

function baseChunk(completionId: string, model: string) {
	return {
		id: completionId,
		object: "chat.completion.chunk" as const,
		created: unixTimestamp(),
		model,
	};
}

// ---------------------------------------------------------------------------
// EngineStreamChunk → OpenAI SSE
// ---------------------------------------------------------------------------

/**
 * Convert the engine's stream into OpenAI-formatted SSE strings.
 * Emits: role-first chunk, content/reasoning/tool_call deltas, a terminal
 * finish_reason chunk, and (optionally) a usage-only chunk.
 */
export async function* engineStreamToSSE(
	stream: AsyncIterable<EngineStreamChunk>,
	opts: ChunkOpts,
): AsyncIterable<string> {
	const { completionId, model } = opts;
	let started = false;
	let finishReason: FinishReason = null;
	let sawToolCall = false;
	let lastUsage: EngineUsage | undefined;

	for await (const ev of stream) {
		if (!started) {
			yield encodeSSE({
				...baseChunk(completionId, model),
				choices: [
					{ index: 0, delta: { role: "assistant" }, finish_reason: null },
				],
			});
			started = true;
		}

		const delta: Record<string, unknown> = {};
		if (ev.contentDelta) delta.content = ev.contentDelta;
		if (ev.reasoningDelta) delta.reasoning_content = ev.reasoningDelta;
		if (ev.toolCallDelta) {
			sawToolCall = true;
			const tc = ev.toolCallDelta;
			const fn: Record<string, unknown> = {};
			if (tc.name !== undefined) fn.name = tc.name;
			if (tc.argumentsDelta !== undefined) fn.arguments = tc.argumentsDelta;
			delta.tool_calls = [
				{
					index: tc.index,
					...(tc.id !== undefined ? { id: tc.id } : {}),
					type: "function",
					function: fn,
				},
			];
		}

		if (ev.usage) lastUsage = ev.usage;
		if (ev.finishReason) finishReason = ev.finishReason;

		if (Object.keys(delta).length > 0) {
			yield encodeSSE({
				...baseChunk(completionId, model),
				choices: [{ index: 0, delta, finish_reason: null }],
			});
		}
	}

	// Terminal chunk with finish_reason.
	if (!started) {
		yield encodeSSE({
			...baseChunk(completionId, model),
			choices: [
				{ index: 0, delta: { role: "assistant" }, finish_reason: null },
			],
		});
	}
	yield encodeSSE({
		...baseChunk(completionId, model),
		choices: [
			{
				index: 0,
				delta: {},
				finish_reason: finishReason ?? (sawToolCall ? "tool_calls" : "stop"),
			},
		],
	});

	if (opts.includeUsage && lastUsage) {
		yield encodeSSE({
			...baseChunk(completionId, model),
			choices: [],
			usage: toOpenAIUsage(lastUsage),
		});
	}
}

// ---------------------------------------------------------------------------
// EngineResult → OpenAI non-streaming response
// ---------------------------------------------------------------------------

export function buildChatCompletion(
	result: EngineResult,
	opts: { id: string; model: string },
) {
	const message: Record<string, unknown> = {
		role: "assistant",
		content: result.content || null,
	};
	if (result.reasoning) message.reasoning_content = result.reasoning;
	if (result.toolCalls.length > 0) {
		message.tool_calls = result.toolCalls.map((tc) => ({
			id: tc.id ?? `call_${Math.random().toString(36).slice(2, 12)}`,
			type: "function",
			function: { name: tc.function.name, arguments: tc.function.arguments },
		}));
	}

	return {
		id: opts.id,
		object: "chat.completion" as const,
		created: unixTimestamp(),
		model: opts.model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: result.finishReason ?? "stop",
			},
		],
		usage: toOpenAIUsage(result.usage),
	};
}
