import type { MiddlewareHandler } from "hono";
import { v4 as uuidv4 } from "uuid";

/** Request logging middleware */
export const loggingMiddleware: MiddlewareHandler = async (c, next) => {
	const requestId = uuidv4();
	const method = c.req.method;
	const path = c.req.path;
	const startTime = Date.now();

	c.set("requestId", requestId);
	c.res.headers.set("X-Request-Id", requestId);

	console.log(
		`[${new Date().toISOString()}] --> ${method} ${path} (requestId: ${requestId})`,
	);

	await next();

	const duration = Date.now() - startTime;
	const statusCode = c.res.status;

	console.log(
		`[${new Date().toISOString()}] <-- ${method} ${path} ${statusCode} ${duration}ms (requestId: ${requestId})`,
	);
};
