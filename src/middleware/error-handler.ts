import type { ErrorHandler } from "hono";
import {
	Errors,
	ValidationError,
	createErrorResponse,
	mapReasonixError,
} from "../lib/errors.js";

/** Global error handler middleware */
export const errorHandler: ErrorHandler = (err, c) => {
	let appError = Errors.internalError("An unexpected error occurred");

	if (err instanceof ValidationError) {
		appError = err.toAppError();
	} else if (err instanceof Error) {
		appError = mapReasonixError(err.name, err.message);
	}

	return c.json(
		createErrorResponse(appError),
		appError.status as
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
			| 504,
	);
};
