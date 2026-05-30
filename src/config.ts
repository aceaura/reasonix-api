import "dotenv/config";
import { z } from "zod";
import type { ServerConfig } from "./lib/types.js";

const envSchema = z.object({
	PORT: z.coerce.number().default(8080),
	HOST: z.string().default("0.0.0.0"),
	API_KEY: z.string().default(""),
	DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
	DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
	SESSION_TTL_MINUTES: z.coerce.number().default(60),
	MAX_CONCURRENT_SESSIONS: z.coerce.number().default(100),
	DEFAULT_MODEL: z.string().default("deepseek-v4-flash"),
	MODEL_GPT_4O: z.string().default("deepseek-v4-flash"),
	MODEL_GPT_4O_MINI: z.string().default("deepseek-v4-flash"),
	MODEL_GPT_35_TURBO: z.string().default("deepseek-chat"),
	MAX_TOKENS: z.coerce.number().default(4096),
	BUDGET_USD: z.coerce.number().default(10),
	LOG_LEVEL: z.string().default("info"),
	CORS_ORIGINS: z.string().default("*"),
	REASONING_EFFORT: z.enum(["low", "medium", "high", "max"]).default("high"),
	ENABLE_RESPONSE_CACHE: z
		.string()
		.default("false")
		.transform((v) => v === "true" || v === "1"),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: ServerConfig | null = null;

export function loadConfig(overrides?: Partial<EnvConfig>): ServerConfig {
	const env = envSchema.parse({ ...process.env, ...overrides });

	const serverConfig: ServerConfig = {
		port: env.PORT,
		host: env.HOST,
		apiKey: env.API_KEY,
		deepseekApiKey: env.DEEPSEEK_API_KEY,
		deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
		sessionTtlMinutes: env.SESSION_TTL_MINUTES,
		maxConcurrentSessions: env.MAX_CONCURRENT_SESSIONS,
		modelMapping: {
			"gpt-4o": env.MODEL_GPT_4O,
			"gpt-4o-mini": env.MODEL_GPT_4O_MINI,
			"gpt-3.5-turbo": env.MODEL_GPT_35_TURBO,
		},
		defaultModel: env.DEFAULT_MODEL,
		maxTokens: env.MAX_TOKENS,
		budgetUsd: env.BUDGET_USD,
		logLevel: env.LOG_LEVEL,
		corsOrigins: env.CORS_ORIGINS,
		reasoningEffort: env.REASONING_EFFORT,
		responseCacheEnabled: env.ENABLE_RESPONSE_CACHE,
	};

	config = serverConfig;
	return serverConfig;
}

export function getConfig(): ServerConfig {
	if (!config) {
		throw new Error("Configuration not loaded. Call loadConfig() first.");
	}
	return config;
}
