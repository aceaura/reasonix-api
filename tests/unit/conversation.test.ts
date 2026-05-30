import { beforeEach, describe, expect, it } from "vitest";
import {
	ConversationStore,
	deriveConversationKey,
	responseCacheKey,
} from "../../src/lib/conversation.js";
import type { EngineResult, EngineUsage } from "../../src/reasonix/engine.js";
import { toEngineMessages } from "../../src/reasonix/messages.js";

const usage = (o: Partial<EngineUsage> = {}): EngineUsage => ({
	promptTokens: 100,
	completionTokens: 10,
	totalTokens: 110,
	cachedHitTokens: 0,
	cachedMissTokens: 100,
	...o,
});

describe("deriveConversationKey", () => {
	it("prefers an explicit id", () => {
		const msgs = toEngineMessages([{ role: "user", content: "hi" }]);
		expect(deriveConversationKey(msgs, "sess-abc")).toBe("sess-abc");
	});

	it("is deterministic for the same prefix", () => {
		const a = toEngineMessages([
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "q2" },
		]);
		const b = toEngineMessages([
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "q3" }, // different final turn, same prefix
		]);
		// Same prefix → same conversation key (continuation maps back).
		expect(deriveConversationKey(a)).toBe(deriveConversationKey(b));
	});

	it("differs for different conversations", () => {
		const a = toEngineMessages([{ role: "user", content: "alpha" }]);
		const b = toEngineMessages([{ role: "user", content: "beta" }]);
		expect(deriveConversationKey(a)).not.toBe(deriveConversationKey(b));
	});
});

describe("ConversationStore.recordUsage", () => {
	let store: ConversationStore;
	beforeEach(() => {
		store = new ConversationStore({ ttlMinutes: 60 });
	});

	it("accumulates usage across turns", () => {
		store.recordUsage("c1", usage({ promptTokens: 100, cachedHitTokens: 0 }));
		store.recordUsage("c1", usage({ promptTokens: 120, cachedHitTokens: 80 }));
		const s = store.get("c1");
		expect(s?.turns).toBe(2);
		expect(s?.promptTokens).toBe(220);
		expect(s?.cachedHitTokens).toBe(80);
	});
});

describe("ConversationStore response cache", () => {
	const result: EngineResult = {
		content: "cached answer",
		toolCalls: [],
		usage: usage(),
		finishReason: "stop",
	};

	it("is disabled by default", () => {
		const store = new ConversationStore();
		store.setCachedResponse("k", result);
		expect(store.getCachedResponse("k")).toBeUndefined();
	});

	it("returns a stored result when enabled", () => {
		const store = new ConversationStore({ responseCacheEnabled: true });
		store.setCachedResponse("k", result);
		expect(store.getCachedResponse("k")?.content).toBe("cached answer");
	});

	it("never caches tool-call turns", () => {
		const store = new ConversationStore({ responseCacheEnabled: true });
		const toolResult: EngineResult = {
			...result,
			toolCalls: [
				{ id: "c", type: "function", function: { name: "f", arguments: "{}" } },
			],
		};
		store.setCachedResponse("k", toolResult);
		expect(store.getCachedResponse("k")).toBeUndefined();
	});
});

describe("responseCacheKey", () => {
	it("is stable for identical inputs and varies with params", () => {
		const msgs = toEngineMessages([{ role: "user", content: "hi" }]);
		const k1 = responseCacheKey("deepseek-chat", msgs, { temperature: 0 });
		const k2 = responseCacheKey("deepseek-chat", msgs, { temperature: 0 });
		const k3 = responseCacheKey("deepseek-chat", msgs, { temperature: 1 });
		expect(k1).toBe(k2);
		expect(k1).not.toBe(k3);
	});
});
