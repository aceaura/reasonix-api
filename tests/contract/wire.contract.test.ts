/**
 * WIRE CONTRACT — proves a request param actually reaches the DeepSeek HTTP body
 * through the REAL reasonix DeepSeekClient, with zero network/tokens.
 *
 * We stub global fetch, run a real adapter.chat(), and inspect the outgoing JSON.
 * This is the authoritative check that `reasoning_effort` (the OpenCode effort
 * variant) is passed through verbatim — not defaulted, not dropped, not gated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReasonixAdapter } from "../../src/reasonix/adapter.js";

const realFetch = globalThis.fetch;
let captured: { url: string; body: Record<string, unknown> } | undefined;

function fakeDeepSeekResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: { content: "ok", reasoning_content: null, tool_calls: [] },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
				prompt_cache_hit_tokens: 0,
				prompt_cache_miss_tokens: 1,
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

beforeEach(() => {
	captured = undefined;
	globalThis.fetch = vi.fn(
		(
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (init?.body && typeof init.body === "string") {
				captured = { url, body: JSON.parse(init.body) };
			}
			return Promise.resolve(fakeDeepSeekResponse());
		},
	) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("reasoning_effort reaches the DeepSeek request body", () => {
	const adapter = new ReasonixAdapter({
		apiKey: "sk-test",
		baseUrl: "https://api.deepseek.com",
	});

	it("forwards a standard effort verbatim", async () => {
		await adapter.chat({
			model: "deepseek-reasoner",
			messages: [{ role: "user", content: "hi" }],
			reasoningEffort: "high",
		});
		expect(captured?.body.reasoning_effort).toBe("high");
	});

	it("forwards a non-standard effort verbatim (no enum gate)", async () => {
		await adapter.chat({
			model: "deepseek-reasoner",
			messages: [{ role: "user", content: "hi" }],
			reasoningEffort: "xhigh",
		});
		expect(captured?.body.reasoning_effort).toBe("xhigh");
	});

	it("omits reasoning_effort entirely when not supplied (no default)", async () => {
		await adapter.chat({
			model: "deepseek-reasoner",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(captured?.body).not.toHaveProperty("reasoning_effort");
	});

	it("also passes seed/stop through via extraBody", async () => {
		await adapter.chat({
			model: "deepseek-chat",
			messages: [{ role: "user", content: "hi" }],
			extraBody: { seed: 7, stop: ["END"] },
		});
		expect(captured?.body.seed).toBe(7);
		expect(captured?.body.stop).toEqual(["END"]);
	});
});
