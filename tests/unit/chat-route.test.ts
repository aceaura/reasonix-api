/**
 * HTTP-level test of the chat route using a mock engine (no network).
 * Exercises validation, tools passthrough, usage/x-cache headers, and streaming.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getConfig } from "../../src/config.js";
import { setEngine } from "../../src/reasonix/adapter.js";
import type {
	EngineChatRequest,
	EngineResult,
	EngineStreamChunk,
	ReasonixEngine,
} from "../../src/reasonix/engine.js";

// biome-ignore lint/suspicious/noExplicitAny: assertions on dynamic JSON responses
type Json = any;

let lastRequest: EngineChatRequest | undefined;

function mockEngine(
	opts: { result?: Partial<EngineResult>; stream?: EngineStreamChunk[] } = {},
): ReasonixEngine {
	return {
		reasonixVersion: "test",
		async chat(req) {
			lastRequest = req;
			return {
				content: "mock answer",
				toolCalls: [],
				usage: {
					promptTokens: 100,
					completionTokens: 5,
					totalTokens: 105,
					cachedHitTokens: 0,
					cachedMissTokens: 100,
				},
				finishReason: "stop",
				...opts.result,
			};
		},
		async *stream(req) {
			lastRequest = req;
			const chunks = opts.stream ?? [
				{ contentDelta: "mock" },
				{ finishReason: "stop" as const },
			];
			for (const c of chunks) yield c;
		},
	};
}

function post(body: unknown, headers: Record<string, string> = {}) {
	return app.fetch(
		new Request("http://local/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${getConfig().apiKey}`,
				...headers,
			},
			body: JSON.stringify(body),
		}),
	);
}

beforeEach(() => {
	lastRequest = undefined;
	setEngine(mockEngine());
});

describe("POST /v1/chat/completions (non-streaming)", () => {
	it("returns an OpenAI-shaped completion with cached_tokens and x-cache", async () => {
		const res = await post({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-cache")).toBe("MISS");
		expect(res.headers.get("x-session-id")).toBeTruthy();
		const json = (await res.json()) as Json;
		expect(json.object).toBe("chat.completion");
		expect(json.choices[0].message.content).toBe("mock answer");
		expect(json.usage.prompt_tokens_details.cached_tokens).toBe(0);
	});

	it("reports x-cache HIT when the engine reports cached tokens", async () => {
		setEngine(
			mockEngine({
				result: {
					usage: {
						promptTokens: 100,
						completionTokens: 5,
						totalTokens: 105,
						cachedHitTokens: 90,
						cachedMissTokens: 10,
					},
				},
			}),
		);
		const res = await post({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.headers.get("x-cache")).toBe("HIT");
	});

	it("forwards reasoning_effort verbatim, including non-standard values (no enum gate)", async () => {
		const res = await post({
			model: "deepseek-reasoner",
			messages: [{ role: "user", content: "hi" }],
			reasoning_effort: "xhigh",
		});
		expect(res.status).toBe(200); // not rejected by a strict enum
		expect(lastRequest?.reasoningEffort).toBe("xhigh");
	});

	it("applies NO default reasoning_effort when the client omits it", async () => {
		await post({
			model: "deepseek-reasoner",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(lastRequest?.reasoningEffort).toBeUndefined();
	});

	it("passes the full message history to the engine (not just the last user message)", async () => {
		await post({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: "be terse" },
				{ role: "user", content: "q1" },
				{ role: "assistant", content: "a1" },
				{ role: "user", content: "q2" },
			],
		});
		expect(lastRequest?.messages.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"user",
		]);
		expect(lastRequest?.messages.at(-1)?.content).toBe("q2");
	});

	it("forwards tools and unsupported params (seed/stop) via extraBody", async () => {
		await post({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			seed: 42,
			stop: ["END"],
			top_p: 0.5,
			tools: [
				{
					type: "function",
					function: {
						name: "search",
						description: "d",
						parameters: { type: "object" },
					},
				},
			],
		});
		expect(lastRequest?.tools?.[0]?.function.name).toBe("search");
		expect(lastRequest?.extraBody).toMatchObject({
			seed: 42,
			stop: ["END"],
			top_p: 0.5,
		});
	});

	it("returns tool_calls when the engine emits them", async () => {
		setEngine(
			mockEngine({
				result: {
					content: "",
					toolCalls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "search", arguments: '{"q":"x"}' },
						},
					],
					finishReason: "tool_calls",
				},
			}),
		);
		const res = await post({
			model: "gpt-4o",
			messages: [{ role: "user", content: "find x" }],
		});
		const json = (await res.json()) as Json;
		expect(json.choices[0].message.tool_calls[0].function.name).toBe("search");
		expect(json.choices[0].finish_reason).toBe("tool_calls");
	});

	it("rejects a request missing model with 400", async () => {
		const res = await post({ messages: [{ role: "user", content: "hi" }] });
		expect(res.status).toBe(400);
	});

	it("rejects a request with no API key (401)", async () => {
		const res = await app.fetch(
			new Request("http://local/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-4o",
					messages: [{ role: "user", content: "hi" }],
				}),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("rejects a request with a wrong API key (401)", async () => {
		const res = await post(
			{ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
			{
				Authorization: "Bearer wrong-key",
			},
		);
		expect(res.status).toBe(401);
	});
});

describe("POST /v1/chat/completions (streaming)", () => {
	it("streams SSE chunks ending in [DONE]", async () => {
		const res = await post({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			stream: true,
		});
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await res.text();
		expect(text).toContain('"role":"assistant"');
		expect(text).toContain('"content":"mock"');
		expect(text).toContain("data: [DONE]");
	});
});
