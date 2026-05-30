import { Hono } from "hono";
import { getFactory } from "../lib/client.js";
import { getConversationStore } from "../lib/conversation.js";

const healthRouter = new Hono();

/** Health check endpoint */
healthRouter.get("/", (c) => {
	const uptime = process.uptime();
	const memory = process.memoryUsage();

	let reasonixStatus = "disconnected";
	let sessionCount = 0;
	try {
		const factory = getFactory();
		if (factory) reasonixStatus = "connected";
	} catch {
		/* not initialized */
	}
	try {
		sessionCount = getConversationStore().size();
	} catch {
		/* not initialized */
	}

	return c.json({
		status: "ok",
		version: "0.1.0",
		uptime,
		clients: {
			reasonix: reasonixStatus,
		},
		sessions: {
			active: sessionCount,
		},
		memory: {
			heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
			heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
			rss: Math.round(memory.rss / 1024 / 1024),
		},
		timestamp: new Date().toISOString(),
	});
});

/** Liveness probe */
healthRouter.get("/live", (c) => c.json({ status: "alive" }));

/** Readiness probe */
healthRouter.get("/ready", (c) => {
	try {
		getFactory();
		return c.json({ status: "ready" });
	} catch {
		return c.json(
			{ status: "not ready", reason: "Reasonix client not initialized" },
			503,
		);
	}
});

export { healthRouter };
