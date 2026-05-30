import { Hono } from "hono";
import { getConversationStore } from "../lib/conversation.js";

const adminRouter = new Hono();

/**
 * GET /admin/cache/stats
 * Global + per-conversation cache accounting (cached/prompt hit ratio, counts).
 * Reflects LOCAL accounting only — DeepSeek's server-side prefix cache is not
 * observable here beyond the per-turn cached_tokens already folded into totals.
 */
adminRouter.get("/cache/stats", (c) => {
	const store = getConversationStore();
	const stats = store.stats();
	return c.json({
		object: "cache.stats",
		hit_ratio: stats.hitRatio,
		conversations: stats.conversations,
		response_cache: {
			enabled: stats.responseCacheEnabled,
			size: stats.responseCacheSize,
		},
		totals: {
			turns: stats.totals.turns,
			prompt_tokens: stats.totals.promptTokens,
			completion_tokens: stats.totals.completionTokens,
			cached_hit_tokens: stats.totals.cachedHitTokens,
			cached_miss_tokens: stats.totals.cachedMissTokens,
		},
		sessions: stats.sessions.map((s) => ({
			id: s.id,
			turns: s.turns,
			prompt_tokens: s.promptTokens,
			completion_tokens: s.completionTokens,
			cached_hit_tokens: s.cachedHitTokens,
			hit_ratio: s.hitRatio,
			created_at: s.createdAt,
			last_accessed_at: s.lastAccessedAt,
		})),
	});
});

/**
 * POST /admin/cache/flush
 * Clears LOCAL state: conversation stats + the optional response cache.
 * Does NOT (and cannot) clear DeepSeek's server-side prefix cache.
 */
adminRouter.post("/cache/flush", (c) => {
	const cleared = getConversationStore().flush();
	return c.json({
		object: "cache.flush",
		cleared: {
			conversations: cleared.conversations,
			response_cache: cleared.responseCache,
		},
		note: "Local state cleared. DeepSeek server-side prefix cache is unaffected.",
	});
});

export { adminRouter };
