import type { MiddlewareHandler } from "hono";
import { getConfig } from "../config.js";

/**
 * Authentication middleware — validates the API key on EVERY request
 * (chat, models, embeddings, health, admin). The only exception is CORS
 * preflight (OPTIONS), which by spec carries no Authorization header.
 *
 * The expected key is `config.apiKey`, which defaults to the DeepSeek key
 * (see config.ts) — so clients authenticate to this proxy with the DeepSeek key.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
	// CORS preflight never carries credentials — let it through.
	if (c.req.method === "OPTIONS") {
		return next();
	}

	const config = getConfig();

	const authHeader = c.req.header("Authorization");
	const apiKeyHeader = c.req.header("x-api-key");
	const token =
		authHeader?.replace(/^Bearer\s+/i, "").trim() ?? apiKeyHeader?.trim();

	if (!token) {
		return c.json(
			{
				error: {
					message:
						"Missing API key. Provide via Authorization header or x-api-key header.",
					type: "invalid_request_error",
					code: "missing_api_key",
				},
			},
			401,
		);
	}

	if (token !== config.apiKey) {
		return c.json(
			{
				error: {
					message: "Incorrect API key provided.",
					type: "invalid_request_error",
					code: "invalid_api_key",
				},
			},
			401,
		);
	}

	await next();
};
