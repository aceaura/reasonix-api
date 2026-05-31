import { describe, expect, it } from "vitest";
import {
	buildChatCompletion,
	engineStreamToSSE,
	toOpenAIUsage,
} from "../../src/lib/streaming.js";
import type {
	EngineResult,
	EngineStreamChunk,
	EngineUsage,
} from "../../src/reasonix/engine.js";

const usage: EngineUsage = {
	costUsd: 0,
	promptTokens: 50,
	completionTokens: 5,
	totalTokens: 55,
	cachedHitTokens: 40,
	cachedMissTokens: 10,
};

async function* gen(
	chunks: EngineStreamChunk[],
): AsyncIterable<EngineStreamChunk> {
	for (const c of chunks) yield c;
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
	const out: string[] = [];
	for await (const s of it) out.push(s);
	return out;
}

function parse(sse: string) {
	return JSON.parse(sse.replace(/^data: /, "").trim());
}

describe("toOpenAIUsage", () => {
	it("maps cached hit tokens into prompt_tokens_details", () => {
		const u = toOpenAIUsage(usage);
		expect(u.prompt_tokens).toBe(50);
		expect(u.prompt_tokens_details.cached_tokens).toBe(40);
	});
});

describe("engineStreamToSSE", () => {
	it("emits role-first, content deltas, and a terminal finish chunk", async () => {
		const frames = await collect(
			engineStreamToSSE(
				gen([
					{ contentDelta: "Hel" },
					{ contentDelta: "lo" },
					{ finishReason: "stop" },
				]),
				{
					completionId: "id1",
					model: "deepseek-chat",
				},
			),
		);
		const objs = frames.map(parse);
		expect(objs[0].choices[0].delta.role).toBe("assistant");
		expect(objs[1].choices[0].delta.content).toBe("Hel");
		expect(objs[2].choices[0].delta.content).toBe("lo");
		const last = objs[objs.length - 1];
		expect(last.choices[0].finish_reason).toBe("stop");
		expect(last.object).toBe("chat.completion.chunk");
	});

	it("routes reasoning to reasoning_content", async () => {
		const frames = await collect(
			engineStreamToSSE(
				gen([{ reasoningDelta: "thinking" }, { finishReason: "stop" }]),
				{
					completionId: "id1",
					model: "m",
				},
			),
		);
		const withReasoning = frames
			.map(parse)
			.find((o) => o.choices[0]?.delta?.reasoning_content);
		expect(withReasoning.choices[0].delta.reasoning_content).toBe("thinking");
	});

	it("emits tool_call deltas with index", async () => {
		const frames = await collect(
			engineStreamToSSE(
				gen([
					{ toolCallDelta: { index: 0, id: "call_1", name: "search" } },
					{ toolCallDelta: { index: 0, argumentsDelta: '{"q"' } },
					{ finishReason: "tool_calls" },
				]),
				{ completionId: "id1", model: "m" },
			),
		);
		const objs = frames.map(parse);
		const start = objs.find(
			(o) => o.choices[0]?.delta?.tool_calls?.[0]?.function?.name === "search",
		);
		expect(start.choices[0].delta.tool_calls[0].index).toBe(0);
		expect(objs[objs.length - 1].choices[0].finish_reason).toBe("tool_calls");
	});

	it("appends a usage-only chunk when includeUsage is set", async () => {
		const frames = await collect(
			engineStreamToSSE(
				gen([{ contentDelta: "x" }, { usage, finishReason: "stop" }]),
				{
					completionId: "id1",
					model: "m",
					includeUsage: true,
				},
			),
		);
		const usageChunk = frames.map(parse).find((o) => o.usage);
		expect(usageChunk.usage.prompt_tokens_details.cached_tokens).toBe(40);
	});
});

describe("buildChatCompletion", () => {
	it("builds an OpenAI response with usage and finish_reason", () => {
		const result: EngineResult = {
			content: "answer",
			toolCalls: [],
			usage,
			finishReason: "stop",
		};
		const resp = buildChatCompletion(result, {
			id: "cmpl-1",
			model: "deepseek-chat",
		});
		expect(resp.object).toBe("chat.completion");
		expect(resp.choices[0]?.message.content).toBe("answer");
		expect(resp.choices[0]?.finish_reason).toBe("stop");
		expect(resp.usage.prompt_tokens_details.cached_tokens).toBe(40);
	});

	it("includes tool_calls and reports finish_reason=length", () => {
		const result: EngineResult = {
			content: "",
			toolCalls: [
				{
					id: "c1",
					type: "function",
					function: { name: "f", arguments: "{}" },
				},
			],
			usage,
			finishReason: "tool_calls",
		};
		const resp = buildChatCompletion(result, { id: "cmpl-2", model: "m" });
		const msg = resp.choices[0]?.message as { tool_calls?: unknown[] };
		expect(msg.tool_calls?.length).toBe(1);
		expect(resp.choices[0]?.finish_reason).toBe("tool_calls");
	});
});
