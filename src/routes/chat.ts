import { type Context, Hono } from "hono";
import { z } from "zod";
import { getFactory } from "../lib/client.js";
import {
	deriveConversationKey,
	getConversationStore,
	responseCacheKey,
} from "../lib/conversation.js";
import {
	type AppError,
	Errors,
	createErrorResponse,
	mapReasonixError,
} from "../lib/errors.js";
import { eventBus } from "../lib/events.js";
import {
	SSE_DONE,
	SSE_HEADERS,
	buildChatCompletion,
	encodeSSE,
	engineStreamToSSE,
} from "../lib/streaming.js";
import { generateCompletionId, unixTimestamp } from "../lib/types.js";
import { zValidator } from "../middleware/validator.js";
import { getEngine } from "../reasonix/adapter.js";
import type {
	EngineChatRequest,
	EngineStreamChunk,
	EngineTool,
	EngineUsage,
	ReasonixEngine,
} from "../reasonix/engine.js";
import { toEngineMessages } from "../reasonix/messages.js";

const chatRouter = new Hono();

// ---------------------------------------------------------------------------
// Request schema (OpenAI-compatible, permissive on tools/extras)
// ---------------------------------------------------------------------------

const messageSchema = z.object({
	role: z.enum(["system", "user", "assistant", "tool", "developer"]),
	content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
	name: z.string().optional(),
	tool_call_id: z.string().optional(),
	tool_calls: z.array(z.any()).optional(),
});

const chatRequestSchema = z.object({
	model: z.string().min(1),
	messages: z.array(messageSchema).min(1),
	stream: z.boolean().optional().default(false),
	temperature: z.number().min(0).max(2).optional(),
	top_p: z.number().min(0).max(1).optional(),
	max_tokens: z.number().int().positive().optional(),
	max_completion_tokens: z.number().int().positive().optional(),
	stop: z.union([z.string(), z.array(z.string())]).optional(),
	seed: z.number().int().optional(),
	presence_penalty: z.number().min(-2).max(2).optional(),
	frequency_penalty: z.number().min(-2).max(2).optional(),
	user: z.string().optional(),
	tools: z.array(z.any()).optional(),
	tool_choice: z
		.union([
			z.string(),
			z.object({ type: z.string(), function: z.object({ name: z.string() }) }),
		])
		.optional(),
	response_format: z
		.object({ type: z.enum(["text", "json_object"]) })
		.optional(),
	// Pass-through: accept any value (e.g. OpenCode "xhigh", OpenAI "minimal").
	// Forwarded verbatim to DeepSeek, which validates it — we don't gate it.
	reasoning_effort: z.string().optional(),
	session_id: z.string().optional(),
	stream_options: z
		.object({ include_usage: z.boolean().optional() })
		.optional(),
});

type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map OpenAI tool definitions to engine tools (deterministic). */
function mapTools(tools: unknown[] | undefined): EngineTool[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	const out: EngineTool[] = [];
	for (const t of tools) {
		const tool = t as {
			function?: { name?: string; description?: string; parameters?: unknown };
		};
		if (tool?.function?.name) {
			out.push({
				type: "function",
				function: {
					name: tool.function.name,
					description: tool.function.description,
					parameters:
						(tool.function.parameters as Record<string, unknown>) ?? {},
				},
			});
		}
	}
	return out.length > 0 ? out : undefined;
}

/** Collect OpenAI params reasonix doesn't model into a raw passthrough body. */
function buildExtraBody(
	body: ChatRequest,
): Record<string, unknown> | undefined {
	const extra: Record<string, unknown> = {};
	if (body.seed !== undefined) extra.seed = body.seed;
	if (body.stop !== undefined) extra.stop = body.stop;
	if (body.top_p !== undefined) extra.top_p = body.top_p;
	if (body.frequency_penalty !== undefined)
		extra.frequency_penalty = body.frequency_penalty;
	if (body.presence_penalty !== undefined)
		extra.presence_penalty = body.presence_penalty;
	if (body.tool_choice !== undefined) extra.tool_choice = body.tool_choice;
	return Object.keys(extra).length > 0 ? extra : undefined;
}

function buildEngineRequest(
	body: ChatRequest,
	model: string,
): EngineChatRequest {
	const messages = toEngineMessages(body.messages);
	const req: EngineChatRequest = { model, messages };
	const tools = mapTools(body.tools);
	if (tools) req.tools = tools;
	if (body.temperature !== undefined) req.temperature = body.temperature;
	const maxTokens = body.max_tokens ?? body.max_completion_tokens;
	if (maxTokens !== undefined) req.maxTokens = maxTokens;
	if (body.reasoning_effort) req.reasoningEffort = body.reasoning_effort;
	if (body.response_format) req.responseFormat = body.response_format;
	const extra = buildExtraBody(body);
	if (extra) req.extraBody = extra;
	return req;
}

// ---------------------------------------------------------------------------
// POST /completions
// ---------------------------------------------------------------------------

chatRouter.post(
	"/completions",
	zValidator("json", chatRequestSchema),
	async (c) => {
		const body = c.req.valid("json") as ChatRequest;
		const requestId = generateCompletionId();
		const startTime = Date.now();

		eventBus.emit("request.start", {
			method: "POST",
			path: "/v1/chat/completions",
			requestId,
		});

		const factory = getFactory();
		const engine = getEngine();
		const store = getConversationStore();

		const mappedModel = factory.mapModel(body.model);
		const engineReq = buildEngineRequest(body, mappedModel);
		const convKey = deriveConversationKey(
			engineReq.messages,
			c.req.header("x-session-id") || body.session_id,
		);

		try {
			if (body.stream) {
				return streamResponse(c, engine, engineReq, {
					requestId,
					model: mappedModel,
					convKey,
					includeUsage: body.stream_options?.include_usage ?? false,
				});
			}

			// --- Non-streaming ---
			const cacheKey = responseCacheKey(mappedModel, engineReq.messages, {
				tools: engineReq.tools,
				temperature: engineReq.temperature,
				extra: engineReq.extraBody,
			});
			const cached = store.getCachedResponse(cacheKey);
			const result = cached ?? (await engine.chat(engineReq));
			if (!cached) store.setCachedResponse(cacheKey, result);

			store.recordUsage(convKey, result.usage);
			logDeepSeekCall({
				model: mappedModel,
				req: engineReq,
				usage: result.usage,
				stream: false,
				convKey,
			});
			const response = buildChatCompletion(result, {
				id: requestId,
				model: mappedModel,
			});

			emitEnd(requestId, 200, startTime, mappedModel, result.usage, convKey);
			c.header("x-session-id", convKey);
			c.header(
				"x-cache",
				cached
					? "LOCAL_HIT"
					: result.usage.cachedHitTokens > 0
						? "HIT"
						: "MISS",
			);
			return c.json(response);
		} catch (err) {
			emitEnd(requestId, 500, startTime, mappedModel, undefined, convKey);
			const appErr = toAppError(err);
			return c.json(
				createErrorResponse(appErr),
				appErr.status as 400 | 401 | 500 | 502,
			);
		}
	},
);

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

function streamResponse(
	c: Context,
	engine: ReasonixEngine,
	engineReq: EngineChatRequest,
	opts: {
		requestId: string;
		model: string;
		convKey: string;
		includeUsage: boolean;
	},
): Response {
	const store = getConversationStore();
	let captured: EngineUsage | undefined;

	async function* tap(
		src: AsyncIterable<EngineStreamChunk>,
	): AsyncIterable<EngineStreamChunk> {
		for await (const ev of src) {
			if (ev.usage) captured = ev.usage;
			yield ev;
		}
	}

	const sseBody = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				const engineStream = engine.stream(engineReq);
				for await (const chunk of engineStreamToSSE(tap(engineStream), {
					completionId: opts.requestId,
					model: opts.model,
					includeUsage: opts.includeUsage,
				})) {
					controller.enqueue(encoder.encode(chunk));
				}
				controller.enqueue(encoder.encode(SSE_DONE));
				if (captured) store.recordUsage(opts.convKey, captured);
				logDeepSeekCall({
					model: opts.model,
					req: engineReq,
					usage: captured,
					stream: true,
					convKey: opts.convKey,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				controller.enqueue(
					encoder.encode(
						encodeSSE({
							id: opts.requestId,
							object: "chat.completion.chunk",
							created: unixTimestamp(),
							model: opts.model,
							choices: [
								{
									index: 0,
									delta: { content: `Error: ${msg}` },
									finish_reason: "stop",
								},
							],
						}),
					),
				);
				controller.enqueue(encoder.encode(SSE_DONE));
			} finally {
				controller.close();
			}
		},
	});

	return c.body(sseBody, {
		headers: { ...SSE_HEADERS, "x-session-id": opts.convKey },
	});
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** One line per upstream DeepSeek call: native params + cache-hit accounting. */
function logDeepSeekCall(args: {
	model: string;
	req: EngineChatRequest;
	usage: EngineUsage | undefined;
	stream: boolean;
	convKey: string;
}): void {
	const { model, req, usage, stream, convKey } = args;
	const fmt = (v: unknown): string =>
		v === undefined
			? "-"
			: typeof v === "object"
				? JSON.stringify(v)
				: String(v);
	const u = usage
		? `prompt=${usage.promptTokens} completion=${usage.completionTokens} ` +
			`cached_hit=${usage.cachedHitTokens} cached_miss=${usage.cachedMissTokens} ` +
			`hit_ratio=${usage.promptTokens > 0 ? (usage.cachedHitTokens / usage.promptTokens).toFixed(3) : "0"}`
		: "usage=n/a";
	console.log(
		`[${new Date().toISOString()}] deepseek ` +
			`model=${model} effort=${fmt(req.reasoningEffort)} stream=${stream} ` +
			`tools=${req.tools?.length ?? 0} max_tokens=${fmt(req.maxTokens)} ` +
			`| ${u} session=${convKey}`,
	);
}

function emitEnd(
	requestId: string,
	statusCode: number,
	startTime: number,
	model: string,
	usage: EngineUsage | undefined,
	convKey: string,
): void {
	if (usage) {
		eventBus.emit("chat.completion", {
			model,
			promptTokens: usage.promptTokens,
			completionTokens: usage.completionTokens,
			cachedTokens: usage.cachedHitTokens,
			sessionId: convKey,
		});
	}
	eventBus.emit("request.end", {
		method: "POST",
		path: "/v1/chat/completions",
		requestId,
		statusCode,
		durationMs: Date.now() - startTime,
	});
}

function toAppError(err: unknown): AppError {
	if (err instanceof Error) return mapReasonixError(err.name, err.message);
	return Errors.internalError(String(err));
}

export { chatRouter };
