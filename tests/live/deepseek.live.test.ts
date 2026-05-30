/**
 * LIVE DeepSeek tests — these make real API calls and consume tokens.
 * Run with: npm run test:live   (requires DEEPSEEK_API_KEY in .env)
 * Skipped automatically when no key is present.
 *
 * Validates the things only a real call can prove:
 *   - tokens flow and cache accounting is real,
 *   - byte-stable prefix → cache HIT on the second call,
 *   - sampling params (max_tokens) actually reach DeepSeek.
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { ReasonixAdapter } from "../../src/reasonix/adapter.js";
import type { EngineMessage } from "../../src/reasonix/engine.js";

const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEFAULT_MODEL || "deepseek-chat";
const TIMEOUT = 120_000;

const engine = KEY
	? new ReasonixAdapter({ apiKey: KEY, baseUrl: process.env.DEEPSEEK_BASE_URL })
	: (null as never);

// A long, byte-stable prefix (well over DeepSeek's ~64-token cache floor).
// A run-unique marker guarantees the first call is a cache MISS.
const RUN_MARKER = `run-${Date.now()}`;
const REPEATED =
	"DeepSeek context caching reuses identical byte prefixes across requests. ".repeat(
		60,
	);
const LONG_PREFIX = `[${RUN_MARKER}] You are a precise assistant. Reference material follows.\n${REPEATED}`;

describe.skipIf(!KEY)("live DeepSeek", () => {
	it(
		"returns content and real token usage",
		async () => {
			const res = await engine.chat({
				model: MODEL,
				messages: [
					{ role: "user", content: "Reply with the single word: pong" },
				],
				temperature: 0,
				maxTokens: 16,
			});
			expect(res.content.length).toBeGreaterThan(0);
			expect(res.usage.promptTokens).toBeGreaterThan(0);
			expect(res.usage.completionTokens).toBeGreaterThan(0);
		},
		TIMEOUT,
	);

	it(
		"hits the prefix cache on the second identical-prefix request",
		async () => {
			const base: EngineMessage[] = [{ role: "system", content: LONG_PREFIX }];
			const first = await engine.chat({
				model: MODEL,
				messages: [...base, { role: "user", content: "Say A." }],
				temperature: 0,
				maxTokens: 4,
			});
			const second = await engine.chat({
				model: MODEL,
				messages: [...base, { role: "user", content: "Say B." }],
				temperature: 0,
				maxTokens: 4,
			});
			// The shared system prefix should be served from cache on the 2nd call.
			expect(second.usage.cachedHitTokens).toBeGreaterThan(0);
			// Diagnostics for the report.
			console.log(
				`[cache] first hit=${first.usage.cachedHitTokens}/${first.usage.promptTokens}, ` +
					`second hit=${second.usage.cachedHitTokens}/${second.usage.promptTokens}`,
			);
		},
		TIMEOUT,
	);

	it(
		"forwards max_tokens → finish_reason length",
		async () => {
			const res = await engine.chat({
				model: MODEL,
				messages: [
					{ role: "user", content: "Write three paragraphs about the ocean." },
				],
				temperature: 0,
				maxTokens: 1,
			});
			expect(res.finishReason).toBe("length");
		},
		TIMEOUT,
	);

	it(
		"streams content and a final usage",
		async () => {
			let content = "";
			let cached = -1;
			for await (const ch of engine.stream({
				model: MODEL,
				messages: [{ role: "user", content: "Count: one two three" }],
				temperature: 0,
				maxTokens: 24,
			})) {
				if (ch.contentDelta) content += ch.contentDelta;
				if (ch.usage) cached = ch.usage.cachedHitTokens;
			}
			expect(content.length).toBeGreaterThan(0);
			expect(cached).toBeGreaterThanOrEqual(0); // usage chunk arrived
		},
		TIMEOUT,
	);
});
