import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getConfig } from "../../src/config.js";
import {
	ConversationStore,
	getConversationStore,
} from "../../src/lib/conversation.js";
import type { EngineUsage } from "../../src/reasonix/engine.js";

const authHeaders = () => ({ Authorization: `Bearer ${getConfig().apiKey}` });

const usage = (o: Partial<EngineUsage> = {}): EngineUsage => ({
	promptTokens: 100,
	completionTokens: 10,
	totalTokens: 110,
	cachedHitTokens: 0,
	cachedMissTokens: 100,
	costUsd: 0,
	...o,
});

// biome-ignore lint/suspicious/noExplicitAny: assertions on dynamic JSON
type Json = any;

describe("ConversationStore.stats / flush", () => {
	let store: ConversationStore;
	beforeEach(() => {
		store = new ConversationStore();
	});

	it("aggregates global totals and per-session hit ratio", () => {
		store.recordUsage("a", usage({ promptTokens: 100, cachedHitTokens: 80 }));
		store.recordUsage("a", usage({ promptTokens: 100, cachedHitTokens: 100 }));
		store.recordUsage("b", usage({ promptTokens: 50, cachedHitTokens: 0 }));

		const s = store.stats();
		expect(s.conversations).toBe(2);
		expect(s.totals.promptTokens).toBe(250);
		expect(s.totals.cachedHitTokens).toBe(180);
		expect(s.hitRatio).toBeCloseTo(180 / 250, 4);
		const a = s.sessions.find((x) => x.id === "a");
		expect(a?.turns).toBe(2);
		expect(a?.hitRatio).toBeCloseTo(180 / 200, 4);
	});

	it("reports hitRatio 0 when there are no prompt tokens", () => {
		expect(store.stats().hitRatio).toBe(0);
	});

	it("flush clears conversations and reports counts", () => {
		store.recordUsage("a", usage());
		store.recordUsage("b", usage());
		const cleared = store.flush();
		expect(cleared.conversations).toBe(2);
		expect(store.size()).toBe(0);
		expect(store.stats().conversations).toBe(0);
	});
});

describe("admin routes", () => {
	it("GET /admin/cache/stats returns aggregated stats", async () => {
		getConversationStore().flush();
		getConversationStore().recordUsage(
			"conv-x",
			usage({ promptTokens: 200, cachedHitTokens: 150 }),
		);
		const res = await app.fetch(
			new Request("http://local/admin/cache/stats", { headers: authHeaders() }),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as Json;
		expect(json.object).toBe("cache.stats");
		expect(json.conversations).toBeGreaterThanOrEqual(1);
		expect(json.totals.prompt_tokens).toBeGreaterThanOrEqual(200);
		expect(json.hit_ratio).toBeGreaterThan(0);
		expect(Array.isArray(json.sessions)).toBe(true);
	});

	it("POST /admin/cache/flush clears local state", async () => {
		getConversationStore().recordUsage("conv-y", usage());
		const res = await app.fetch(
			new Request("http://local/admin/cache/flush", {
				method: "POST",
				headers: authHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as Json;
		expect(json.object).toBe("cache.flush");
		expect(json.cleared.conversations).toBeGreaterThanOrEqual(1);
		expect(getConversationStore().size()).toBe(0);
	});

	it("requires the API key (401 without it)", async () => {
		const stats = await app.fetch(
			new Request("http://local/admin/cache/stats"),
		);
		expect(stats.status).toBe(401);
		const flush = await app.fetch(
			new Request("http://local/admin/cache/flush", { method: "POST" }),
		);
		expect(flush.status).toBe(401);
	});
});
