import { serve } from "@hono/node-server";
import "dotenv/config";
import { app } from "../src/app.js";
import { getConfig } from "../src/config.js";
import { printStartupBanner } from "../src/lib/banner.js";

const config = getConfig();
const port = config.port;
const host = config.host;

console.log(`Reasonix API v0.1.0 (dev) starting on ${host}:${port}...`);

serve(
	{
		fetch: app.fetch,
		port,
		hostname: host,
	},
	() => printStartupBanner({ host, port, apiKey: config.apiKey }),
);
