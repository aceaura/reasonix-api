# Reasonix API

OpenAI-compatible HTTP API server wrapping **[Reasonix](https://github.com/esengine/reasonix)** — a DeepSeek-native coding agent with cache-first loop architecture. Exposes the OpenAI Chat Completions API surface (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/health`) with Reasonix's byte-stable prefix cache for long session optimization.

## Quick Start

```bash
git clone https://github.com/aceaura/reasonix-api.git
cd reasonix-api
cp .env.example .env
# Edit .env with your DEEPSEEK_API_KEY
npm install
npm run build
npm start
```

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-local-proxy-token" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Docker

```bash
DEEPSEEK_API_KEY=sk-your-key docker compose up
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `API_KEY` | `""` | Client authentication key (empty = allow all) |
| `DEEPSEEK_API_KEY` | — | **Required** DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Override for self-hosted endpoints |
| `SESSION_TTL_MINUTES` | `60` | Conversation tracking entry expiry (minutes) |
| `MAX_CONCURRENT_SESSIONS` | `100` | Maximum tracked conversations |
| `DEFAULT_MODEL` | `deepseek-chat` | Real DeepSeek model used when a request model is unmapped |
| `MODEL_GPT_4O` | `deepseek-chat` | Map `gpt-4o` requests |
| `MODEL_GPT_4O_MINI` | `deepseek-chat` | Map `gpt-4o-mini` requests |
| `MODEL_GPT_35_TURBO` | `deepseek-chat` | Map `gpt-3.5-turbo` requests |
| `MAX_TOKENS` | `4096` | Default max output tokens |
| `BUDGET_USD` | `10` | Soft USD budget cap |
| `REASONING_EFFORT` | `high` | DeepSeek reasoning effort (`low`, `medium`, `high`, `max`) |
| `ENABLE_RESPONSE_CACHE` | `false` | Local short-circuit: return a cached completion for a byte-identical repeat request (0 tokens). Off by default — changes semantics. |
| `LOG_LEVEL` | `info` | Log level |
| `CORS_ORIGINS` | `*` | CORS origins |

> **Model names matter.** Map to models the real DeepSeek API serves (`deepseek-chat`, `deepseek-reasoner`). Aspirational names like `deepseek-v4-flash` will 400 against `api.deepseek.com`.

## API

### Chat Completions — `POST /v1/chat/completions`

OpenAI-compatible and **stateless**: the full `messages` array (system, user, assistant, tool results) and any `tools` are forwarded to DeepSeek on every request — exactly how OpenCode and most OpenAI clients behave. There is no hidden server-side context; resend history each turn.

- **Tools are passed through.** The model's `tool_calls` are streamed back to the client to execute; the server does not run tools itself.
- **Sampling params are honored:** `temperature`, `max_tokens`, `seed`, `stop`, `top_p`, `presence_penalty`, `frequency_penalty`, `tool_choice`, `response_format`, `reasoning_effort`.
- **Cache savings come from byte-stable prefixes.** Because the unchanged prefix of a conversation is serialized identically each turn, DeepSeek's automatic context cache hits and `usage.prompt_tokens_details.cached_tokens` rises.

Response headers:
- `x-session-id` — derived from the request's stable prefix (or an explicit `x-session-id` you send), for cache attribution.
- `x-cache` — `HIT` when DeepSeek served cached prompt tokens, `MISS` otherwise (`LOCAL_HIT` when the optional response cache answered).

```bash
# Stateless: resend the full history each turn (cache hits come from the stable prefix)
curl -s http://localhost:8088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[
        {"role":"system","content":"You are concise."},
        {"role":"user","content":"Hello"},
        {"role":"assistant","content":"Hi!"},
        {"role":"user","content":"Tell me more"}
      ],"stream":true}'
```

### Models — `GET /v1/models`

```bash
curl http://localhost:8080/v1/models
```

### Health — `GET /health`

```bash
curl http://localhost:8088/health
```

### Cache admin — `GET /admin/cache/stats`, `POST /admin/cache/flush`

Local cache accounting. `stats` reports global and per-conversation `cached/prompt` hit ratio; `flush` clears the local conversation stats + optional response cache. Neither touches DeepSeek's server-side prefix cache.

```bash
curl http://localhost:8088/admin/cache/stats
# { "hit_ratio": 0.78, "conversations": 12, "totals": {...}, "sessions": [...] }

curl -X POST http://localhost:8088/admin/cache/flush
# { "cleared": { "conversations": 12, "response_cache": 0 } }
```

> These endpoints are covered by the same auth as everything else: when `API_KEY` is set they require it; when `API_KEY` is empty (dev mode) they're open. Set `API_KEY` before exposing the server.

## Use with OpenCode

Point OpenCode at this server as an OpenAI-compatible provider:

- **Base URL:** `http://localhost:8088/v1`
- **API key:** any value (set `API_KEY` in `.env` to require a specific one; empty = allow all)
- **Model:** `gpt-4o` (mapped to `deepseek-chat`) or `deepseek-chat` directly

OpenCode sends full history + its own tools each turn; the server forwards both to DeepSeek, streams `tool_calls` back for OpenCode to execute, and rides DeepSeek's prefix cache for the unchanged history.

## Architecture

```
OpenCode (stateless, full history + tools)
   │  POST /v1/chat/completions
   ▼
routes/chat.ts ── messages.ts (byte-stable OpenAI→engine) ── conversation.ts (prefix-hash key + cache stats)
   │
   ▼
reasonix/engine.ts  (stable internal contract)
   │
   ▼
reasonix/adapter.ts  ◄── THE ONLY FILE THAT IMPORTS "reasonix"
   │     maps to reasonix DeepSeekClient.chat/stream, normalizes Usage/StreamChunk
   ▼
DeepSeek API  (automatic byte-prefix context cache → cached_tokens)
```

All coupling to the `reasonix` package is isolated in `src/reasonix/adapter.ts`. The rest of the app depends only on the stable `ReasonixEngine` contract in `src/reasonix/engine.ts`.

### Upgrading reasonix

The whole point of the adapter layer:

```bash
npm install reasonix@<new-version>
npm run test:contract     # pins the exact reasonix surface the adapter uses
```

If `test:contract` is green, you're done. If it goes red, the upgrade changed an assumption — fix **only** `src/reasonix/adapter.ts`, re-run until green, then `npm run test:all`.

## Tests

| Script | What | Tokens |
|---|---|---|
| `npm test` | unit + contract (CI gate) | 0 |
| `npm run test:unit` | pure logic + HTTP route with a mock engine | 0 |
| `npm run test:contract` | pins the reasonix surface (run after upgrades) | 0 |
| `npm run test:live` | real DeepSeek: cache hit, params, streaming | burns tokens |
| `npm run test:e2e` | OpenCode simulation through the full app | burns tokens |
| `npm run test:all` | everything | burns tokens |
| `npm run verify` | build + lint + typecheck + `npm test` | 0 |

`test:live` / `test:e2e` auto-skip when `DEEPSEEK_API_KEY` is absent.

A manual cache benchmark lives in `cache-bench.mjs` (run the server first, then `node cache-bench.mjs`).

## License

MIT — see [LICENSE](LICENSE)
