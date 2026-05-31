import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig } from "./config.js";
import { initClient } from "./lib/client.js";
import { configureConversations } from "./lib/conversation.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { initEngine, refreshBalance } from "./reasonix/adapter.js";
import { adminRouter } from "./routes/admin.js";
import { chatRouter } from "./routes/chat.js";
import { embeddingsRouter } from "./routes/embeddings.js";
import { healthRouter } from "./routes/health.js";
import { modelsRouter } from "./routes/models.js";

// Load configuration
const config = loadConfig();

// Model-mapping factory
initClient(config);

// Reasonix engine (the only coupling to the reasonix package)
initEngine({
	apiKey: config.deepseekApiKey,
	baseUrl: config.deepseekBaseUrl,
});

// Warm the account-balance cache so the first request can log it.
void refreshBalance();

// Conversation tracking (stable session keys + cache accounting)
configureConversations({
	ttlMinutes: config.sessionTtlMinutes,
	maxConversations: config.maxConcurrentSessions,
	responseCacheEnabled: config.responseCacheEnabled,
});

// Create Hono app
const app = new Hono();

// Global error handler
app.onError(errorHandler);

// CORS middleware
app.use(
	"*",
	cors({
		origin: config.corsOrigins === "*" ? "*" : config.corsOrigins.split(","),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["X-Request-Id"],
	}),
);

// Logging middleware
app.use("*", loggingMiddleware);

// Auth middleware (skip for health)
app.use("*", authMiddleware);

// Mount routes
app.route("/health", healthRouter);
app.route("/v1/chat", chatRouter);
app.route("/v1/models", modelsRouter);
app.route("/v1/embeddings", embeddingsRouter);
app.route("/admin", adminRouter);

// 404 handler
app.notFound((c) => {
	return c.json(
		{
			error: {
				message: `Not found: ${c.req.method} ${c.req.path}`,
				type: "not_found",
				code: 404,
			},
		},
		404,
	);
});

export { app };
