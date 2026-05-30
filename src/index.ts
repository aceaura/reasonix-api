import { serve } from "@hono/node-server";
import "dotenv/config";
import { app } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();

const port = config.port;
const host = config.host;

// 0.0.0.0 / :: bind to all interfaces but aren't directly dialable — show a usable host.
const displayHost =
	host === "0.0.0.0" || host === "::" || host === "" ? "localhost" : host;
const baseUrl = `http://${displayHost}:${port}/v1`;
const apiKeyHint = config.apiKey
	? "required — send 'Authorization: Bearer <API_KEY>'"
	: "none (dev mode — set API_KEY in .env to require one)";

console.log(`Reasonix API v0.1.0 starting on ${host}:${port}...`);

serve(
	{
		fetch: app.fetch,
		port,
		hostname: host,
	},
	() => {
		// Only printed once the server has successfully bound the port.
		console.log("");
		console.log(
			"  ┌─────────────────────────────────────────────────────────────┐",
		);
		console.log(
			"  │  OpenAI-compatible endpoint — paste into OpenAI clients:      │",
		);
		console.log(
			"  └─────────────────────────────────────────────────────────────┘",
		);
		console.log(`    OpenAI Base URL : ${baseUrl}`);
		console.log(`    API Key         : ${apiKeyHint}`);
		console.log("");
		console.log(`  Chat:    POST ${baseUrl}/chat/completions`);
		console.log(`  Models:  GET  ${baseUrl}/models`);
		console.log(`  Health:  GET  http://${displayHost}:${port}/health`);
		console.log(
			`  Cache:   GET  http://${displayHost}:${port}/admin/cache/stats`,
		);
	},
);

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("SIGTERM received, shutting down...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("SIGINT received, shutting down...");
	process.exit(0);
});
