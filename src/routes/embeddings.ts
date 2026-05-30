import { Hono } from "hono";
import { z } from "zod";
import type { EmbeddingResponse } from "../lib/types.js";
import { zValidator } from "../middleware/validator.js";

const embeddingsRouter = new Hono();

const embeddingRequestSchema = z
	.object({
		model: z.string(),
		input: z.union([z.string(), z.array(z.string())]),
		encoding_format: z.enum(["float", "base64"]).optional().default("float"),
		user: z.string().optional(),
	})
	.refine(
		(data) => {
			if (typeof data.input === "string") return data.input.length > 0;
			return data.input.length > 0;
		},
		{ message: "input must not be empty" },
	);

/** Create embeddings */
embeddingsRouter.post(
	"/",
	zValidator("json", embeddingRequestSchema),
	async (c) => {
		const body = c.req.valid("json");

		const inputs = Array.isArray(body.input)
			? body.input
			: [body.input as string];
		const dimension = 1536;

		const data = inputs.map((text: string, index: number) => ({
			object: "embedding" as const,
			index,
			embedding: generateMockEmbedding(text, dimension),
		}));

		const response: EmbeddingResponse = {
			object: "list",
			data,
			model: body.model,
			usage: {
				prompt_tokens: estimateTokens(inputs),
				total_tokens: estimateTokens(inputs),
			},
		};

		return c.json(response);
	},
);

export { embeddingsRouter };

/** Generate a deterministic mock embedding vector */
function generateMockEmbedding(text: string, dimension: number): number[] {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}

	const seed = Math.abs(hash);
	const rng = mulberry32(seed);
	const embedding: number[] = [];
	let sum = 0;
	for (let i = 0; i < dimension; i++) {
		const val = rng() * 2 - 1;
		embedding.push(val);
		sum += val * val;
	}
	// Normalize to unit length
	const norm = Math.sqrt(sum);
	return embedding.map((v) => Math.round((v / norm) * 1e6) / 1e6);
}

/** Mulberry32 PRNG */
function mulberry32(seed: number): () => number {
	let a = seed | 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Rough token estimation */
function estimateTokens(inputs: string[]): number {
	return inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}
