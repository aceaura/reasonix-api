import { serve } from "@hono/node-server";
import "dotenv/config";
import { app } from "./app.js";
import { getConfig } from "./config.js";
import { printStartupBanner } from "./lib/banner.js";

const config = getConfig();

const port = config.port;
const host = config.host;

console.log(`Reasonix API v0.1.0 starting on ${host}:${port}...`);

serve(
	{
		fetch: app.fetch,
		port,
		hostname: host,
	},
	// Only printed once the server has successfully bound the port.
	() => printStartupBanner({ host, port, apiKey: config.apiKey }),
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
