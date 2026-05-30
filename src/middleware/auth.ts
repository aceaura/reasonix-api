import type { MiddlewareHandler } from "hono";
import { getConfig } from "../config.js";

/** Authentication middleware - validates API key from Authorization/x-api-key headers */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
	// Skip auth for health endpoints
	if (c.req.path.startsWith("/health")) {
		return next();
	}

	const config = getConfig();

	// If no API_KEY configured, allow all requests (no auth)
	if (!config.apiKey) {
		return next();
	}

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
