// Cache hit rate benchmark for reasonix-api
//
// Tests the CacheFirstLoop prefix-cache stability by:
// 1. Creating a session with a long system prompt
// 2. Making multiple consecutive turns
// 3. Measuring cache hit ratio per turn
// 4. Comparing single-session vs multi-session cache behavior

const BASE = "http://localhost:8088";
const MODEL = "deepseek-v4-flash";

// Use a long system prompt to make cache hits measurable
const LONG_SYSTEM = `
You are an expert software engineer. Your codebase has the following structure:

\`\`\`
src/
  server/
    routes/
      auth.ts          - JWT authentication middleware
      users.ts         - User CRUD endpoints
      products.ts      - Product catalog endpoints
    middleware/
      logging.ts       - Request/response logging
      validation.ts    - Zod schema validation
    utils/
      db.ts            - PostgreSQL connection pool
      cache.ts         - Redis cache wrapper
  client/
    components/
      Layout.tsx       - Main application layout
      Sidebar.tsx      - Navigation sidebar
    hooks/
      useAuth.ts       - Authentication hook
      useProducts.ts   - Product data fetching hook
  shared/
    types.ts           - Shared TypeScript types
    constants.ts       - Application constants
\`\`\`

The project uses:
- Backend: Node.js 22, Express, PostgreSQL, Redis
- Frontend: React 19, TypeScript, TailwindCSS
- DevOps: Docker, GitHub Actions
- API design: RESTful, JSON responses, Bearer token auth

Always answer concisely in Chinese.
`;

async function chat(sessionId, userMessage, label) {
  const headers = {
    "Content-Type": "application/json",
    "x-session-id": sessionId,
  };

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: LONG_SYSTEM },
      { role: "user", content: userMessage },
    ],
    stream: false,
    max_tokens: 256,
  };

  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json();
  const elapsed = Date.now() - t0;

  if (!res.ok) {
    console.log(`  [${label}] ERROR ${res.status}:`, json.error?.message);
    return null;
  }

  const usage = json.usage;
  const cacheHit = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheMiss = usage.prompt_tokens - (usage?.prompt_tokens_details?.cached_tokens ?? 0);
  const hitRate = usage.prompt_tokens > 0 ? (cacheHit / usage.prompt_tokens * 100).toFixed(1) : "0";

  return {
    label,
    status: res.status,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheHitTokens: cacheHit,
    cacheMissTokens: cacheMiss,
    cacheHitRate: `${hitRate}%`,
    elapsedMs: elapsed,
    content: json.choices?.[0]?.message?.content?.substring(0, 80),
  };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Reasonix API - Cache Hit Rate Benchmark                 ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Model:", MODEL.padEnd(48), "║");
  console.log("║  System prompt:", String(LONG_SYSTEM.length + " chars").padEnd(42), "║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // === TEST 1: Multi-turn session (same session ID) ===
  console.log("━━━ TEST 1: Multi-turn same session ━━━");
  console.log("(Same x-session-id, CacheFirstLoop maintains prefix cache)\n");

  const sessionId = `cache-bench-${Date.now()}`;
  const turns = [
    "简单介绍一下这个项目的技术栈",
    "auth.ts 里面大概做了什么？",
    "如何改进 products 端点的性能？",
    "docker-compose 应该怎么写？",
    "给这个项目写一个 README 概要",
  ];

  const results = [];

  for (let i = 0; i < turns.length; i++) {
    const r = await chat(sessionId, turns[i], `Turn ${i + 1}`);
    if (r) results.push(r);
  }

  console.log("");
  printTable(results);

  // === TEST 2: New session (same prompt, different session) ===
  console.log("\n━━━ TEST 2: Fresh session (no cache) ━━━");
  console.log("(New session ID, first call has cold cache)\n");

  const coldResults = [];
  for (let i = 0; i < 3; i++) {
    const newSid = `cold-start-${Date.now()}-${i}`;
    const r = await chat(newSid, "简单介绍一下这个项目的技术栈", `Cold ${i + 1}`);
    if (r) coldResults.push(r);
  }

  printTable(coldResults);

  // === TEST 3: Session continuation (long session simulation) ===
  console.log("\n━━━ TEST 3: Long session (10 turns) ━━━");
  console.log("(Same session, simulating extended conversation)\n");

  const longSid = `long-session-${Date.now()}`;
  const longTurns = [
    "列出 src/server/ 下所有文件",
    "useAuth hook 的作用是什么",
    "如何添加一个 admin 角色",
    "数据库迁移策略应该怎么设计",
    "前端国际化的最佳实践",
    "如何做 CI/CD pipeline",
    "Redis 缓存策略应该怎么做",
    "API rate limiting 如何处理",
    "webSocket vs SSE 的选择",
    "微服务拆分时机是什么",
  ];

  const longResults = [];
  for (let i = 0; i < longTurns.length; i++) {
    const r = await chat(longSid, longTurns[i], `L${i + 1}`);
    if (r) longResults.push(r);
  }

  printTable(longResults);

  // === Summary ===
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    SUMMARY                                   ║");

  // Test 1 summary
  if (results.length > 1) {
    const avgHit = results.reduce((s, r) => s + parseFloat(r.cacheHitRate), 0) / results.length;
    const lastHit = parseFloat(results[results.length - 1].cacheHitRate);
    console.log(`║  Test 1 (Same Session):                                      ║`);
    console.log(`║    Avg cache hit: ${String(avgHit.toFixed(1) + "%").padEnd(44)}║`);
    console.log(`║    Last turn hit: ${String(lastHit.toFixed(1) + "%").padEnd(44)}║`);
    console.log(`║    Cache trend: ${(lastHit > (results[1]?.cacheHitRate || "0") ? "📈 Improving" : "📉 Stable/Mixed").padEnd(44)}║`);
  }

  if (coldResults.length > 0) {
    const avgCold = coldResults.reduce((s, r) => s + parseFloat(r.cacheHitRate), 0) / coldResults.length;
    console.log(`║  Test 2 (Cold Starts):                                       ║`);
    console.log(`║    Avg cache hit: ${String(avgCold.toFixed(1) + "%").padEnd(44)}║`);
  }

  if (longResults.length > 1) {
    const avgLong = longResults.reduce((s, r) => s + parseFloat(r.cacheHitRate), 0) / longResults.length;
    const lastLong = parseFloat(longResults[longResults.length - 1].cacheHitRate);
    const firstLong = parseFloat(longResults[0].cacheHitRate);
    console.log(`║  Test 3 (10-Turn Session):                                   ║`);
    console.log(`║    Turn 1 hit:  ${String(firstLong.toFixed(1) + "%").padEnd(42)}║`);
    console.log(`║    Turn 10 hit: ${String(lastLong.toFixed(1) + "%").padEnd(42)}║`);
    console.log(`║    Avg cache hit: ${String(avgLong.toFixed(1) + "%").padEnd(44)}║`);
  }

  // Cost estimation
  if (results.length > 0) {
    const totalCacheHit = results.reduce((s, r) => s + r.cacheHitTokens, 0);
    const totalPrompt = results.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = results.reduce((s, r) => s + r.completionTokens, 0);
    // DeepSeek pricing: $0.07/M input cache-miss, ~$0.01/M input cache-hit, $0.28/M output
    const inputCostMiss = ((totalPrompt - totalCacheHit) / 1_000_000) * 0.07;
    const inputCostHit = (totalCacheHit / 1_000_000) * 0.01;
    const outputCost = (totalCompletion / 1_000_000) * 0.28;
    const totalCost = inputCostMiss + inputCostHit + outputCost;

    console.log(`║  Cost estimate (Test 1):                                     ║`);
    console.log(`║    Input miss: $${inputCostMiss.toFixed(4).padEnd(43)}║`);
    console.log(`║    Input hit:  $${inputCostHit.toFixed(4).padEnd(43)}║`);
    console.log(`║    Output:     $${outputCost.toFixed(4).padEnd(43)}║`);
    console.log(`║    Total:      $${totalCost.toFixed(4).padEnd(43)}║`);
  }

  console.log("╚══════════════════════════════════════════════════════════════╝");
}

function printTable(rows) {
  if (rows.length === 0) return;

  console.log("  " + "─".repeat(100));
  console.log("  │ Label    │ Status │ Prompt │ CacheHit │ CacheMiss │   Hit% │ Comp │ Total  │ Time  │ Preview");
  console.log("  " + "─".repeat(100));

  for (const r of rows) {
    const label = r.label.padEnd(9);
    const status = String(r.status).padEnd(5);
    const prompt = String(r.promptTokens).padEnd(7);
    const cacheHit = String(r.cacheHitTokens).padEnd(9);
    const cacheMiss = String(r.cacheMissTokens).padEnd(10);
    const hitRate = r.cacheHitRate.padEnd(6);
    const comp = String(r.completionTokens).padEnd(5);
    const total = String(r.totalTokens).padEnd(7);
    const time = String(r.elapsedMs + "ms").padEnd(5);
    const preview = (r.content || "").substring(0, 35).padEnd(36);
    console.log(`  │ ${label}│ ${status} │ ${prompt} │ ${cacheHit} │ ${cacheMiss} │ ${hitRate} │ ${comp} │ ${total} │ ${time} │ ${preview}│`);
  }
  console.log("  " + "─".repeat(100));
}

main().catch(console.error);
