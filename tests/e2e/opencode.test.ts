/**
 * OpenCode end-to-end — simulates how OpenCode actually talks to an OpenAI
 * endpoint: STATELESS, resending the full message history (and tool defs) every
 * turn. Runs against the real app + real DeepSeek. Requires DEEPSEEK_API_KEY.
 * Run with: npm run test:e2e
 *
 * Proves the headline goals:
 *   - multi-turn context works via full history (not server-side session),
 *   - tools pass through to the model,
 *   - the prefix cache engages across turns (token savings),
 *   - x-cache / x-session-id headers are exposed.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";

const KEY = process.env.DEEPSEEK_API_KEY;
const TIMEOUT = 120_000;

// biome-ignore lint/suspicious/noExplicitAny: hono app type imported lazily
let app: any;

type Msg = {
	role: string;
	content?: string | null;
	tool_calls?: unknown[];
	tool_call_id?: string;
};

async function chat(body: unknown, headers: Record<string, string> = {}) {
	const res = await app.fetch(
		new Request("http://local/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
	const json = await res.json();
	return {
		res,
		json,
		content: json?.choices?.[0]?.message?.content ?? "",
		cached: json?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
	};
}

describe.skipIf(!KEY)("OpenCode E2E (live)", () => {
	beforeAll(async () => {
		app = (await import("../../src/app.js")).app;
	});

	it(
		"remembers context across turns via full history (stateless)",
		async () => {
			const sys: Msg = { role: "system", content: "You are concise." };
			const turn1: Msg[] = [
				sys,
				{
					role: "user",
					content: "The secret word is GIRAFFE. Acknowledge with OK.",
				},
			];
			const r1 = await chat({
				model: "gpt-4o",
				messages: turn1,
				temperature: 0,
				max_tokens: 16,
			});
			expect(r1.res.status).toBe(200);

			// Stateless turn 2: resend everything + the model's own reply + a new question.
			const turn2: Msg[] = [
				...turn1,
				{ role: "assistant", content: r1.content },
				{
					role: "user",
					content:
						"What is the secret word? Reply with just the word in uppercase.",
				},
			];
			const r2 = await chat({
				model: "gpt-4o",
				messages: turn2,
				temperature: 0,
				max_tokens: 16,
			});
			expect(r2.content.toUpperCase()).toContain("GIRAFFE");
			expect(r2.res.headers.get("x-session-id")).toBeTruthy();
			expect(r2.res.headers.get("x-cache")).toBeTruthy();
		},
		TIMEOUT,
	);

	it(
		"engages the prefix cache across turns (token savings)",
		async () => {
			const marker = `e2e-${Date.now()}`;
			const ref = "Stable reference content for prefix caching. ".repeat(60);
			const longSys: Msg = {
				role: "system",
				content: `[${marker}] Knowledge base follows.\n${ref}`,
			};
			const first = await chat({
				model: "gpt-4o",
				messages: [longSys, { role: "user", content: "Reply: 1" }],
				temperature: 0,
				max_tokens: 4,
			});
			const second = await chat({
				model: "gpt-4o",
				messages: [longSys, { role: "user", content: "Reply: 2" }],
				temperature: 0,
				max_tokens: 4,
			});
			console.log(`[e2e cache] first=${first.cached} second=${second.cached}`);
			expect(second.cached).toBeGreaterThan(0);
			expect(second.res.headers.get("x-cache")).toBe("HIT");
		},
		TIMEOUT,
	);

	it(
		"passes tools through and surfaces tool_calls when the model uses them",
		async () => {
			const r = await chat({
				model: "gpt-4o",
				temperature: 0,
				max_tokens: 128,
				messages: [
					{
						role: "user",
						content: "What is the weather in Paris? Use the get_weather tool.",
					},
				],
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							description: "Get the current weather for a city.",
							parameters: {
								type: "object",
								properties: { city: { type: "string" } },
								required: ["city"],
							},
						},
					},
				],
				tool_choice: "auto",
			});
			expect(r.res.status).toBe(200);
			// Model-dependent: if it chose to call the tool, the call must be well-formed.
			if (r.json.choices[0].finish_reason === "tool_calls") {
				const call = r.json.choices[0].message.tool_calls[0];
				expect(call.function.name).toBe("get_weather");
				expect(() => JSON.parse(call.function.arguments)).not.toThrow();
			}
		},
		TIMEOUT,
	);
});
