import { z } from "zod";

// === OPENAI API TYPES ===

// Message roles
export const MessageRoleSchema = z.enum([
	"system",
	"user",
	"assistant",
	"tool",
	"developer",
]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// Content parts
export const TextContentPartSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

export const ImageUrlContentPartSchema = z.object({
	type: z.literal("image_url"),
	image_url: z.object({
		url: z.string(),
		detail: z.enum(["auto", "low", "high"]).optional(),
	}),
});

export const ContentPartSchema = z.union([
	TextContentPartSchema,
	ImageUrlContentPartSchema,
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

// Tool call
export const FunctionSchema = z.object({
	name: z.string(),
	arguments: z.string(), // JSON string
});

export const ToolCallSchema = z.object({
	id: z.string(),
	type: z.literal("function"),
	function: FunctionSchema,
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// Message
export const MessageSchema = z.object({
	role: MessageRoleSchema,
	content: z
		.union([z.string(), z.array(ContentPartSchema), z.null()])
		.optional(),
	name: z.string().optional(),
	tool_call_id: z.string().optional(),
	tool_calls: z.array(ToolCallSchema).optional(),
});
export type Message = z.infer<typeof MessageSchema>;

// Tool definition
export const ToolSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		description: z.string().optional(),
		parameters: z.record(z.unknown()), // JSON Schema object
		strict: z.boolean().optional(),
	}),
});
export type Tool = z.infer<typeof ToolSchema>;

// Tool choice
export const ToolChoiceSchema = z.union([
	z.enum(["none", "auto", "required"]),
	z.object({
		type: z.literal("function"),
		function: z.object({ name: z.string() }),
	}),
]);
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

// === CHAT COMPLETION REQUEST ===
export const ChatCompletionRequestSchema = z.object({
	model: z.string(),
	messages: z.array(MessageSchema),
	stream: z.boolean().optional().default(false),
	temperature: z.number().min(0).max(2).optional(),
	top_p: z.number().min(0).max(1).optional(),
	max_tokens: z.number().int().positive().optional(),
	max_completion_tokens: z.number().int().positive().optional(),
	seed: z.number().int().optional(),
	stop: z.union([z.string(), z.array(z.string())]).optional(),
	n: z.number().int().positive().optional().default(1),
	logprobs: z.boolean().optional().default(false),
	top_logprobs: z.number().int().min(0).max(20).optional(),
	tools: z.array(ToolSchema).optional(),
	tool_choice: ToolChoiceSchema.optional(),
	parallel_tool_calls: z.boolean().optional().default(true),
	response_format: z
		.object({
			type: z.enum(["text", "json_object"]),
		})
		.optional(),
	user: z.string().optional(),
	reasoning_effort: z.string().optional(),
	frequency_penalty: z.number().min(-2).max(2).optional(),
	presence_penalty: z.number().min(-2).max(2).optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// === RESPONSE TYPES ===

// Usage
export const CompletionUsageSchema = z.object({
	prompt_tokens: z.number().int(),
	completion_tokens: z.number().int(),
	total_tokens: z.number().int(),
	prompt_tokens_details: z
		.object({
			cached_tokens: z.number().int().optional(),
			audio_tokens: z.number().int().optional(),
		})
		.optional(),
	completion_tokens_details: z
		.object({
			reasoning_tokens: z.number().int().optional(),
			accepted_prediction_tokens: z.number().int().optional(),
			rejected_prediction_tokens: z.number().int().optional(),
			audio_tokens: z.number().int().optional(),
		})
		.optional(),
});
export type CompletionUsage = z.infer<typeof CompletionUsageSchema>;

// Message delta (streaming)
export const MessageDeltaSchema = z.object({
	role: z.literal("assistant").optional(),
	content: z.string().nullable().optional(),
	refusal: z.string().nullable().optional(),
	tool_calls: z
		.array(
			z.object({
				index: z.number().int(),
				id: z.string().nullable().optional(),
				type: z.literal("function").optional(),
				function: z.object({
					name: z.string().nullable().optional(),
					arguments: z.string().nullable().optional(),
				}),
			}),
		)
		.optional(),
	function_call: z
		.object({
			name: z.string().nullable().optional(),
			arguments: z.string().nullable().optional(),
		})
		.optional(),
});
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

// Choice (non-streaming)
export const ChatChoiceSchema = z.object({
	index: z.number().int(),
	message: z.object({
		role: z.literal("assistant"),
		content: z.string().nullable(),
		refusal: z.string().nullable().optional(),
		tool_calls: z.array(ToolCallSchema).optional(),
		function_call: z
			.object({
				name: z.string(),
				arguments: z.string(),
			})
			.optional(),
		audio: z
			.object({
				id: z.string(),
				data: z.string(),
				expires_at: z.number(),
				transcript: z.string(),
			})
			.optional(),
		annotations: z.array(z.unknown()).optional(),
	}),
	finish_reason: z
		.enum(["stop", "length", "tool_calls", "content_filter", "function_call"])
		.nullable(),
	logprobs: z
		.object({
			content: z.array(
				z.object({
					token: z.string(),
					logprob: z.number(),
					bytes: z.array(z.number().int()).nullable().optional(),
					top_logprobs: z.array(
						z.object({
							token: z.string(),
							logprob: z.number(),
							bytes: z.array(z.number().int()).nullable().optional(),
						}),
					),
				}),
			),
		})
		.nullable()
		.optional(),
});
export type ChatChoice = z.infer<typeof ChatChoiceSchema>;

// Choice (streaming chunk)
export const ChunkChoiceSchema = z.object({
	index: z.number().int(),
	delta: MessageDeltaSchema,
	finish_reason: z
		.enum(["stop", "length", "tool_calls", "content_filter", "error"])
		.nullable(),
	logprobs: z
		.object({
			content: z.array(
				z.object({
					token: z.string(),
					logprob: z.number(),
					bytes: z.array(z.number().int()).nullable().optional(),
					top_logprobs: z
						.array(
							z.object({
								token: z.string(),
								logprob: z.number(),
								bytes: z.array(z.number().int()).nullable().optional(),
							}),
						)
						.optional(),
				}),
			),
		})
		.nullable()
		.optional(),
});
export type ChunkChoice = z.infer<typeof ChunkChoiceSchema>;

// Full response (non-streaming)
export const ChatCompletionResponseSchema = z.object({
	id: z.string(),
	object: z.literal("chat.completion"),
	created: z.number().int(),
	model: z.string(),
	service_tier: z.string().optional(),
	system_fingerprint: z.string().optional(),
	choices: z.array(ChatChoiceSchema),
	usage: CompletionUsageSchema.optional(),
});
export type ChatCompletionResponse = z.infer<
	typeof ChatCompletionResponseSchema
>;

// Streaming chunk
export const ChatCompletionChunkSchema = z.object({
	id: z.string(),
	object: z.literal("chat.completion.chunk"),
	created: z.number().int(),
	model: z.string(),
	service_tier: z.string().optional(),
	system_fingerprint: z.string().optional(),
	choices: z.array(ChunkChoiceSchema),
	usage: CompletionUsageSchema.optional(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

// === MODELS ===
export const ModelSchema = z.object({
	id: z.string(),
	object: z.literal("model"),
	created: z.number().int(),
	owned_by: z.string(),
});
export type Model = z.infer<typeof ModelSchema>;

export const ModelsResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(ModelSchema),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

// === EMBEDDINGS ===
export const EmbeddingRequestSchema = z.object({
	model: z.string(),
	input: z.union([
		z.string(),
		z.array(z.string()),
		z.array(z.array(z.number())),
	]),
	encoding_format: z.enum(["float", "base64"]).optional().default("float"),
	dimensions: z.number().int().positive().optional(),
	user: z.string().optional(),
});
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;

export const EmbeddingSchema = z.object({
	object: z.literal("embedding"),
	embedding: z.array(z.number()),
	index: z.number().int(),
});
export type Embedding = z.infer<typeof EmbeddingSchema>;

export const EmbeddingResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(EmbeddingSchema),
	model: z.string(),
	usage: z.object({
		prompt_tokens: z.number().int(),
		total_tokens: z.number().int(),
	}),
});
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

// === ERROR ===
export const ErrorResponseSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable().optional(),
		code: z.string().nullable().optional(),
	}),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// === MODEL INFO (backward compat) ===
export interface ModelInfo {
	id: string;
	object: "model";
	created: number;
	owned_by: string;
	permission: Array<Record<string, unknown>>;
}

// === TOOL DEFINITION ===
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// === SERVER CONFIG ===
export interface ServerConfig {
	port: number;
	host: string;
	apiKey: string;
	deepseekApiKey: string;
	deepseekBaseUrl: string;
	sessionTtlMinutes: number;
	maxConcurrentSessions: number;
	modelMapping: Record<string, string>;
	defaultModel: string;
	maxTokens: number;
	budgetUsd: number;
	logLevel: string;
	corsOrigins: string;
	reasoningEffort: "low" | "medium" | "high" | "max";
	responseCacheEnabled: boolean;
	usdToCny: number;
}

// === HELPER: Generate completion ID ===
export function generateCompletionId(): string {
	return `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// === HELPER: Current Unix timestamp ===
export function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}
