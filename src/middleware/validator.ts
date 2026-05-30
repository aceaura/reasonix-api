import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { ValidationError } from "../lib/errors.js";

/** Wrapper around @hono/zod-validator that throws ValidationError on failure */
export function zValidator(
	target: "json" | "query" | "param" | "header" | "cookie" | "form",
	schema: ZodSchema,
) {
	return honoZValidator(target, schema, (result) => {
		if (!result.success) {
			const details: Record<string, unknown> = {
				issues: result.error.issues.map((issue) => ({
					path: issue.path.join("."),
					message: issue.message,
					code: issue.code,
				})),
			};
			throw new ValidationError("Request validation failed", details);
		}
	});
}
