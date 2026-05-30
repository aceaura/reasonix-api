import { serve } from "@hono/node-server";
import { app } from "../src/app.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

console.log(`Starting Reasonix API server on ${host}:${port}...`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
});

console.log(`Reasonix API running at http://${host}:${port}`);
console.log(`  Health:  GET http://${host}:${port}/health`);
console.log(`  Chat:   POST http://${host}:${port}/v1/chat/completions`);
console.log(`  Models: GET  http://${host}:${port}/v1/models`);
