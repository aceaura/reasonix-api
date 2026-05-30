import type { ErrorResponse } from "./types.js";

export type HttpStatus =
	| 200
	| 201
	| 204
	| 400
	| 401
	| 403
	| 404
	| 405
	| 408
	| 409
	| 422
	| 429
	| 500
	| 501
	| 502
	| 503
	| 504;

export interface AppError {
	status: HttpStatus;
	message: string;
	type: string;
	param?: string | null;
	code?: string | null;
}

export function createErrorResponse(err: AppError): ErrorResponse {
	return {
		error: {
			message: err.message,
			type: err.type,
			param: err.param ?? null,
			code: err.code ?? null,
		},
	};
}

// Pre-defined errors
export const Errors = {
	// 400 Bad Request
	invalidRequest: (message = "Invalid request", param?: string): AppError => ({
		status: 400,
		message,
		type: "invalid_request_error",
		param,
		code: null,
	}),

	missingField: (field: string): AppError => ({
		status: 400,
		message: `Missing required field: ${field}`,
		type: "invalid_request_error",
		param: field,
		code: null,
	}),

	invalidField: (field: string, message?: string): AppError => ({
		status: 400,
		message: message ?? `Invalid value for field: ${field}`,
		type: "invalid_request_error",
		param: field,
		code: null,
	}),

	// 401 Unauthorized
	invalidApiKey: (): AppError => ({
		status: 401,
		message:
			"Incorrect API key provided. You can find your API key at https://platform.deepseek.com/api_keys",
		type: "invalid_request_error",
		param: null,
		code: "invalid_api_key",
	}),

	missingApiKey: (): AppError => ({
		status: 401,
		message:
			"Missing API key. Provide your API key via the Authorization header.",
		type: "invalid_request_error",
		param: null,
		code: "missing_api_key",
	}),

	// 403 Forbidden
	forbidden: (message = "Access forbidden"): AppError => ({
		status: 403,
		message,
		type: "permission_error",
		param: null,
		code: null,
	}),

	// 404 Not Found
	notFound: (path: string): AppError => ({
		status: 404,
		message: `The requested resource was not found: ${path}`,
		type: "not_found_error",
		param: null,
		code: null,
	}),

	methodNotAllowed: (method: string, path: string): AppError => ({
		status: 405,
		message: `Method ${method} not allowed for ${path}`,
		type: "invalid_request_error",
		param: null,
		code: "method_not_allowed",
	}),

	// 408 Request Timeout
	requestTimeout: (): AppError => ({
		status: 408,
		message: "Request timed out",
		type: "timeout_error",
		param: null,
		code: "request_timeout",
	}),

	// 422 Unprocessable Entity
	unprocessableEntity: (message: string): AppError => ({
		status: 422,
		message,
		type: "invalid_request_error",
		param: null,
		code: null,
	}),

	// 429 Too Many Requests
	rateLimitExceeded: (retryAfter?: number): AppError => ({
		status: 429,
		message: retryAfter
			? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
			: "Rate limit exceeded. Please retry later.",
		type: "rate_limit_error",
		param: null,
		code: "rate_limit_exceeded",
	}),

	// 500 Internal Server Error
	internalError: (message = "An unexpected error occurred"): AppError => ({
		status: 500,
		message,
		type: "server_error",
		param: null,
		code: null,
	}),

	// 502 Bad Gateway
	badGateway: (
		message = "Upstream service temporarily unavailable, please retry later.",
	): AppError => ({
		status: 502,
		message,
		type: "server_error",
		param: null,
		code: "bad_gateway",
	}),

	// 503 Service Unavailable
	serviceUnavailable: (
		message = "Service temporarily unavailable",
	): AppError => ({
		status: 503,
		message,
		type: "server_error",
		param: null,
		code: "service_unavailable",
	}),

	// 504 Gateway Timeout
	gatewayTimeout: (message = "Gateway timeout"): AppError => ({
		status: 504,
		message,
		type: "server_error",
		param: null,
		code: "gateway_timeout",
	}),

	// DeepSeek-specific
	deepseekError: (message: string, code?: string): AppError => ({
		status: 502,
		message: `DeepSeek API error: ${message}`,
		type: "server_error",
		param: null,
		code: code ?? "deepseek_error",
	}),

	// Not implemented
	notImplemented: (feature: string): AppError => ({
		status: 501,
		message: `Not implemented: ${feature}`,
		type: "invalid_request_error",
		param: null,
		code: "not_implemented",
	}),

	// Session
	sessionNotFound: (sessionId: string): AppError => ({
		status: 404,
		message: `Session not found: ${sessionId}`,
		type: "not_found_error",
		param: "session_id",
		code: "session_not_found",
	}),

	sessionLimitExceeded: (limit: number): AppError => ({
		status: 429,
		message: `Maximum concurrent sessions (${limit}) exceeded. Please close some sessions.`,
		type: "rate_limit_error",
		param: null,
		code: "session_limit_exceeded",
	}),
} as const;

/** Validation error with structured details */
export class ValidationError extends Error {
	readonly details: Record<string, unknown>;
	readonly status = 400 as const;

	constructor(message: string, details: Record<string, unknown> = {}) {
		super(message);
		this.name = "ValidationError";
		this.details = details;
	}

	toAppError(): AppError {
		return {
			status: 400,
			message: this.message,
			type: "invalid_request_error",
			param: null,
			code: "validation_error",
		};
	}
}

// Map Reasonix/DeepSeek errors to AppError
export function mapReasonixError(
	name: string,
	message: string,
	phase?: string,
): AppError {
	const nameLower = name.toLowerCase();
	const msgLower = message.toLowerCase();

	if (
		nameLower.includes("auth") ||
		nameLower.includes("401") ||
		msgLower.includes("invalid api key") ||
		msgLower.includes("unauthorized")
	) {
		return Errors.invalidApiKey();
	}
	if (nameLower.includes("timeout") || nameLower.includes("408")) {
		return Errors.requestTimeout();
	}
	if (
		nameLower.includes("rate limit") ||
		nameLower.includes("429") ||
		msgLower.includes("rate limit")
	) {
		return Errors.rateLimitExceeded();
	}
	if (
		nameLower.includes("context") ||
		nameLower.includes("token") ||
		msgLower.includes("too many tokens")
	) {
		return Errors.unprocessableEntity(`Token limit exceeded: ${message}`);
	}
	if (
		nameLower.includes("network") ||
		nameLower.includes("fetch") ||
		msgLower.includes("fetch failed")
	) {
		return Errors.badGateway(`Network error: ${message}`);
	}

	return Errors.internalError(`${name}: ${message}`);
}
