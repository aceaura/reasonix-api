import { describe, expect, it } from "vitest";
import {
	Errors,
	ValidationError,
	createErrorResponse,
	mapReasonixError,
} from "../../src/lib/errors.js";

describe("Errors factory", () => {
	it("should create error responses with correct status and type", () => {
		const err = Errors.invalidRequest("Bad input", "messages");
		expect(err.status).toBe(400);
		expect(err.message).toBe("Bad input");
		expect(err.type).toBe("invalid_request_error");
		expect(err.param).toBe("messages");
	});

	it("should create invalidApiKey error", () => {
		const err = Errors.invalidApiKey();
		expect(err.status).toBe(401);
		expect(err.code).toBe("invalid_api_key");
	});

	it("should create rateLimitExceeded error", () => {
		const err = Errors.rateLimitExceeded(30);
		expect(err.status).toBe(429);
		expect(err.code).toBe("rate_limit_exceeded");
		expect(err.message).toContain("30 seconds");
	});

	it("should create internalError", () => {
		const err = Errors.internalError("Something broke");
		expect(err.status).toBe(500);
		expect(err.message).toBe("Something broke");
		expect(err.type).toBe("server_error");
	});

	it("should create serviceUnavailable", () => {
		const err = Errors.serviceUnavailable();
		expect(err.status).toBe(503);
		expect(err.code).toBe("service_unavailable");
	});

	it("should create notFound", () => {
		const err = Errors.notFound("/v1/missing");
		expect(err.status).toBe(404);
		expect(err.message).toContain("/v1/missing");
	});
});

describe("createErrorResponse", () => {
	it("should format AppError to OpenAI error shape", () => {
		const appErr = Errors.invalidApiKey();
		const resp = createErrorResponse(appErr);
		expect(resp.error.message).toBe(appErr.message);
		expect(resp.error.type).toBe(appErr.type);
		expect(resp.error.code).toBe(appErr.code);
	});
});

describe("mapReasonixError", () => {
	it("should map auth errors to 401", () => {
		const err = mapReasonixError("AuthError", "invalid api key");
		expect(err.status).toBe(401);
	});

	it("should map timeout errors to 408", () => {
		const err = mapReasonixError("TimeoutError", "request timed out");
		expect(err.status).toBe(408);
	});

	it("should fallback to 500 for unknown errors", () => {
		const err = mapReasonixError("WeirdThing", "something weird");
		expect(err.status).toBe(500);
	});
});

describe("ValidationError", () => {
	it("should create with details", () => {
		const error = new ValidationError("Validation failed", { field: "name" });
		expect(error.message).toBe("Validation failed");
		expect(error.details.field).toBe("name");
	});

	it("should convert to AppError", () => {
		const error = new ValidationError("Invalid");
		const appErr = error.toAppError();
		expect(appErr.status).toBe(400);
		expect(appErr.code).toBe("validation_error");
	});
});
