/**
 * Shared startup banner used by BOTH entry points (`src/index.ts` for
 * `npm start`, and `scripts/dev.ts` for `npm run dev`) so they never drift.
 */
export function printStartupBanner(opts: {
	host: string;
	port: number;
	apiKey: string;
}): void {
	const { host, port, apiKey } = opts;
	// 0.0.0.0 / :: bind to all interfaces but aren't directly dialable.
	const displayHost =
		host === "0.0.0.0" || host === "::" || host === "" ? "localhost" : host;
	const root = `http://${displayHost}:${port}`;
	const baseUrl = `${root}/v1`;
	const apiKeyHint = apiKey
		? "required — send 'Authorization: Bearer <API_KEY>'"
		: "none (dev mode — set API_KEY in .env to require one)";

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
	console.log(`  Chat:         POST ${baseUrl}/chat/completions`);
	console.log(`  Models:       GET  ${baseUrl}/models`);
	console.log(`  Health:       GET  ${root}/health`);
	console.log(`  Cache stats:  GET  ${root}/admin/cache/stats`);
	console.log(`  Cache flush:  POST ${root}/admin/cache/flush`);
}
