import * as reasonix from "reasonix";
import { DeepSeekClient, Usage, VERSION } from "reasonix";
/**
 * REASONIX UPGRADE CONTRACT.
 *
 * This suite pins the exact reasonix surface `src/reasonix/adapter.ts` relies on.
 * It makes NO network calls. When you bump the `reasonix` dependency, run:
 *
 *     npm run test:contract
 *
 * If anything here goes red, the upgrade changed an assumption the adapter makes.
 * Fix `src/reasonix/adapter.ts` (the only file coupled to reasonix), then make
 * this suite green again. Nothing else in the app should need to change.
 */
import { describe, expect, it } from "vitest";
import { mapUsage } from "../../src/reasonix/adapter.js";

describe("reasonix package exports the adapter depends on", () => {
	it("exposes DeepSeekClient, Usage and VERSION", () => {
		expect(typeof DeepSeekClient).toBe("function");
		expect(typeof Usage).toBe("function");
		expect(typeof VERSION).toBe("string");
	});

	it("DeepSeekClient has chat() and stream() methods", () => {
		const proto = DeepSeekClient.prototype as unknown as Record<
			string,
			unknown
		>;
		expect(typeof proto.chat).toBe("function");
		expect(typeof proto.stream).toBe("function");
	});

	it("DeepSeekClient accepts apiKey/baseUrl/timeoutMs/fetch options", () => {
		// Construction must not throw with the option shape the adapter uses.
		expect(
			() =>
				new DeepSeekClient({
					apiKey: "sk-test",
					baseUrl: "https://example.com",
					timeoutMs: 1000,
					fetch: globalThis.fetch,
				}),
		).not.toThrow();
	});
});

describe("reasonix Usage shape (cache accounting source of truth)", () => {
	it("exposes the cache token fields the adapter reads", () => {
		const u = new Usage(100, 20, 120, 80, 20);
		expect(u.promptTokens).toBe(100);
		expect(u.completionTokens).toBe(20);
		expect(u.totalTokens).toBe(120);
		expect(u.promptCacheHitTokens).toBe(80);
		expect(u.promptCacheMissTokens).toBe(20);
	});

	it("adapter.mapUsage maps a real Usage instance correctly", () => {
		const u = new Usage(10, 2, 12, 7, 3);
		expect(mapUsage(u)).toEqual({
			promptTokens: 10,
			completionTokens: 2,
			totalTokens: 12,
			cachedHitTokens: 7,
			cachedMissTokens: 3,
		});
	});

	it("Usage.fromApi reads DeepSeek raw usage field names", () => {
		// The wire field names the cache depends on must keep mapping through.
		const u = reasonix.Usage.fromApi({
			prompt_tokens: 100,
			completion_tokens: 10,
			total_tokens: 110,
			prompt_cache_hit_tokens: 64,
			prompt_cache_miss_tokens: 36,
		});
		expect(u.promptCacheHitTokens).toBe(64);
	});
});
