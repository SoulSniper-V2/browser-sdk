# Browser SDK

[![npm version](https://img.shields.io/npm/v/%40soulsniper-v2%2Fbrowser-sdk.svg)](https://www.npmjs.com/package/@soulsniper-v2/browser-sdk)
[![CI](https://github.com/SoulSniper-V2/browser-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/SoulSniper-V2/browser-sdk/actions/workflows/ci.yml)

One TypeScript API for browser sessions, rendered artifacts, and provider failover.

Browser SDK keeps browser infrastructure out of the rest of your application. Configure Browserbase first, Cloudflare Browser Run next, then any other adapters you have. Your caller keeps the same method and receives the provider, latency, and failover trail that produced the result.

```bash
npm install @soulsniper-v2/browser-sdk
```

## The short version

```ts
import { fromEnv } from "@soulsniper-v2/browser-sdk";

const browser = fromEnv();
const page = await browser.markdown("https://docs.example.com", {
  waitForSelector: "main",
  maxChars: 20_000,
});

console.log(page.markdown);
console.log(page.provider, page.latencyMs);
console.log(page.failedOverFrom);
```

`fromEnv()` assembles this default runway:

1. Browserbase
2. Cloudflare Browser Run
3. Browserless
4. Steel
5. Local HTML and Playwright fallback

Providers are included only when their credentials are present, except local which is enabled by default. Pass `includeLocal: false` when the process must never use local work.

For a longer cloud runway, set `BROWSER_SDK_EXTENDED_PROVIDERS=true` or pass `includeExtendedProviders: true`. That appends Anchor Browser, Hyperbrowser, and Browser Use Cloud before the local fallback. It is opt-in so adding a new environment variable cannot silently change an existing deployment's route.

## What the SDK covers

- Render HTML with `content()`.
- Get model-ready Markdown with `markdown()`.
- Capture screenshots and PDFs as bytes.
- Combine HTML, Markdown, screenshots, and accessibility data with `snapshot()`.
- Extract structured JSON with `extract()` when a provider exposes a JSON endpoint.
- Discover links with `links()`.
- Crawl bounded sites with `crawl()` when Cloudflare Browser Run is configured.
- Create browser sessions and connect with Playwright, Puppeteer, Selenium, or raw CDP.
- Inspect the route before calling it with `routePreview()`.
- Adapt the plain JSON Schema tools to your own model loop with `@soulsniper-v2/browser-sdk/agent-tools`.
- Use `@soulsniper-v2/browser-sdk-mcp` from Codex, Claude Code, Cursor, or another MCP client.

This is an infrastructure building block, not a claim that multi-provider browser routing is an empty market. Provider SDKs, Playwright MCP, and browser gateways already exist. The reason to use this package is the small in-process TypeScript contract: capability-aware read failover, typed artifacts, pinned session cleanup, and agent docs/MCP in the same repository. See [`docs/positioning.md`](docs/positioning.md) for the tradeoffs.

## Two layers, one core

The `@soulsniper-v2/browser-sdk` package is the application API: your server imports it and owns authorization, workflow state, and side effects. The repository's agent layer is how an agent learns and operates it: `SKILL.md` gives procedural guidance, `npx @soulsniper-v2/browser-sdk` handles one-off CLI work, and `@soulsniper-v2/browser-sdk-mcp` gives an agent a stateful session it can navigate, snapshot, act on, read, screenshot, and close.

## Live sessions

The SDK does not force a browser automation library into your bundle. It returns a standard CDP URL from cloud providers and a native Playwright handle from the local adapter.

```ts
import { fromEnv } from "@soulsniper-v2/browser-sdk";
import { chromium } from "playwright-core";

const browser = fromEnv();

await browser.withSession(
  {
    keepAlive: true,
    metadata: { workflow: "checkout" },
  },
  async (session) => {
    if (!session.connectUrl) {
      throw new Error("This session does not expose a CDP URL.");
    }

    const remote = await chromium.connectOverCDP(session.connectUrl);
    const page = remote.contexts()[0].pages()[0];
    await page.goto("https://app.example.com");
    console.log(await page.title(), session.provider);
    await remote.close();
  },
);
```

`withSession()` always attempts cleanup. Use `createSession()` instead when you need to keep a session alive across multiple jobs and call `session.close()` yourself.

## Explicit providers

```ts
import { createBrowserClient } from "@soulsniper-v2/browser-sdk";
import { browserbase } from "@soulsniper-v2/browser-sdk/browserbase";
import { cloudflare } from "@soulsniper-v2/browser-sdk/cloudflare";
import { browserless } from "@soulsniper-v2/browser-sdk/browserless";
import { steel } from "@soulsniper-v2/browser-sdk/steel";
import { anchor } from "@soulsniper-v2/browser-sdk/anchor";
import { hyperbrowser } from "@soulsniper-v2/browser-sdk/hyperbrowser";
import { browserUse } from "@soulsniper-v2/browser-sdk/browser-use";
import { local } from "@soulsniper-v2/browser-sdk/local";

const browser = createBrowserClient({
  providers: [
    browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    }),
    cloudflare({
      apiToken: process.env.CLOUDFLARE_API_TOKEN!,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    }),
    browserless({ token: process.env.BROWSERLESS_API_KEY! }),
    steel({ apiKey: process.env.STEEL_API_KEY! }),
    anchor({ apiKey: process.env.ANCHOR_API_KEY! }),
    hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! }),
    browserUse({ apiKey: process.env.BROWSER_USE_API_KEY! }),
    local({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }),
  ],
  timeoutMs: 30_000,
  retries: 1,
  strategy: "priority",
  cache: { ttlMs: 60_000, maxEntries: 200 },
});
```

`provider` plus `fallback` is also supported for a two-provider integration. Use `providers` for a longer runway.

## Environment variables

| Provider | Variables |
| :--- | :--- |
| Browserbase | `BROWSERBASE_API_KEY`, optional `BROWSERBASE_PROJECT_ID` |
| Cloudflare Browser Run | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Browserless | `BROWSERLESS_API_KEY` or `BROWSERLESS_TOKEN` |
| Steel | `STEEL_API_KEY` |
| Anchor Browser | `ANCHOR_API_KEY` |
| Hyperbrowser | `HYPERBROWSER_API_KEY` |
| Browser Use Cloud | `BROWSER_USE_API_KEY` |
| Local | `CHROMIUM_EXECUTABLE_PATH` when Playwright cannot find Chromium |

The three extended providers are only added when `BROWSER_SDK_EXTENDED_PROVIDERS=true` (or `includeExtendedProviders: true`).

Provider secrets are server-side credentials. Do not pass them to browser bundles, return them from API routes, or put them in tool output.

## Routing behavior

Every provider declares its capabilities. A `screenshot()` call never enters a provider that only supports sessions, and an `extract()` call never pretends that a Markdown response is structured JSON.

The client uses one cumulative deadline across retries and provider hops. Retryable failures include rate limits, timeouts, network failures, and 5xx responses. Authentication, permission, invalid input, and unsupported-option errors do not retry on the same provider, but the client can still continue to the next capable provider.

Read-only actions can fail over safely. A callback passed to `withSession()` is not automatically replayed after it has clicked, typed, submitted a form, or otherwise caused a side effect. That boundary belongs to the application.

Successful results include `failedOverFrom` when a hop happened:

```ts
[
  {
    provider: "browserbase",
    operation: "markdown",
    reason: "rate_limit",
    retryable: true,
  },
]
```

## Agent tools

```ts
import { createBrowserTools } from "@soulsniper-v2/browser-sdk/agent-tools";

const tools = createBrowserTools(browser);
```

The definitions use plain JSON Schema and have no model dependency. They include `browser_markdown`, `browser_content`, `browser_extract`, `browser_links`, `browser_route`, `browser_providers`, plus capability-gated `browser_snapshot` and `browser_crawl`. Wrap them in the tool format used by your model SDK.

Install the coding-agent skill from the repository:

```bash
npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk
```

Run a one-off read or inspect the configured route without writing application code:

```bash
npx @soulsniper-v2/browser-sdk https://example.com
npx @soulsniper-v2/browser-sdk route markdown
npx @soulsniper-v2/browser-sdk doctor
```

## MCP

```bash
npm install @soulsniper-v2/browser-sdk-mcp
npx -y @soulsniper-v2/browser-sdk-mcp
```

The MCP server exposes stateless read tools plus an explicit stateful browser runtime. Agents can start a session, navigate, snapshot for accessibility refs, take one action, read or screenshot the result, and close the session. See [`packages/browser-sdk-mcp/README.md`](packages/browser-sdk-mcp/README.md) and [`examples/mcp.json`](examples/mcp.json).

## Agent skill and machine-readable docs

The repository ships a coding-agent skill at [`skills/browser-sdk/SKILL.md`](skills/browser-sdk/SKILL.md). The homepage shows its install command directly, and the docs site is a real Fumadocs tree backed by the canonical Markdown in `docs/`. It exposes:

- `/llms.txt` for the product and docs index
- `/llms-full.txt` for the complete Markdown corpus
- `/feeds/docs.jsonl` for one typed record per page
- `/schemamap.xml` for feed discovery
- `/docs/<page>.md` for raw Markdown pages

Refresh `/llms.txt` or a raw page before integrating the package in an agent-owned codebase.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check  # one command for all three
npm run dev
```

The SDK test suite uses a network-free memory provider and explicit failure injection. Provider adapters accept injected `fetch` behavior through the client so request mapping can be tested without live credentials.

## Releases

Both public packages share one version. Update the versions in `packages/browser-sdk/package.json` and `packages/browser-sdk-mcp/package.json`, keep the MCP dependency pinned to that exact SDK version, then push a `vX.Y.Z` tag. `.github/workflows/publish.yml` verifies the tag and manifests, runs the complete check, inspects both tarballs, and publishes missing versions through npm Trusted Publishing with provenance.

## Project layout

```text
packages/browser-sdk/       Core client, adapters, CLI, and tests
packages/browser-sdk-mcp/   Stdio MCP server
apps/site/                  Marketing site and interactive docs
docs/                       Canonical Markdown documentation
skills/browser-sdk/         Coding-agent skill and MCP example
examples/                   Copy-paste integrations
```

## License

MIT.
