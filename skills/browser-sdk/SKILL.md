---
name: browser-sdk
description: Use when building TypeScript browser sessions, rendered page artifacts, browser agents, provider failover, Browserbase, Cloudflare Browser Run, Browserless, Steel, or local Playwright integrations.
license: MIT
compatibility: Node.js 20+. Network access. Optional BROWSERBASE_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, BROWSERLESS_API_KEY, STEEL_API_KEY, ANCHOR_API_KEY, HYPERBROWSER_API_KEY, BROWSER_USE_API_KEY, and CHROMIUM_EXECUTABLE_PATH.
metadata:
  author: SoulSniper-V2
  version: "0.1.0"
---

# Browser SDK

Browser SDK provides one typed client for cloud browser sessions, rendered artifacts, and provider failover.

## Install this skill

```bash
npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk
```

If the Skills CLI is unavailable, save this file as `browser-sdk/SKILL.md` in the agent's skills directory. The hosted copy is `https://browser-sdk.dev/skills/browser-sdk/SKILL.md`.

## Refresh the current docs

Before changing an integration, read the current package README and the machine-readable docs:

1. `README.md`
2. `packages/browser-sdk/README.md`
3. `https://browser-sdk.dev/llms.txt`
4. `https://browser-sdk.dev/llms-full.txt` when exact provider behavior is needed
5. `https://browser-sdk.dev/docs/<page>.md` for the relevant page

When local source and published docs disagree, prefer the installed package types and mention the mismatch.

## Use the provider-neutral client

```ts
import { fromEnv } from "@soulsniper-v2/browser-sdk";

const browser = fromEnv();
const page = await browser.markdown("https://example.com", {
  waitForSelector: "main",
  maxChars: 20_000,
});

console.log(page.markdown);
console.log(page.provider, page.latencyMs, page.failedOverFrom);
```

The default route is Browserbase, Cloudflare Browser Run, Browserless, Steel, then local. Providers without credentials are skipped. Set `includeLocal: false` when local execution is not allowed. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` or pass `includeExtendedProviders: true` to add Anchor Browser, Hyperbrowser, and Browser Use Cloud before local.

## Choose the right operation

| Need | Call |
| :--- | :--- |
| Rendered HTML | `content(url)` |
| Model context | `markdown(url)` |
| Image or PDF artifact | `screenshot(url)` or `pdf(url)` |
| Multiple representations | `snapshot(url)` |
| Structured fields | `extract(url, { prompt, schema })` |
| Page frontier | `links(url)` |
| Bounded site corpus | `crawl(url)` |
| Interactive browser | `withSession(options, callback)` |
| Route inspection | `routePreview(capability)` |

## Routing and retry rules

- Providers must declare the capability they implement.
- `priority` preserves configured order. `cost` uses relative adapter cost hints, not vendor prices.
- Retryable failures are rate limits, timeouts, network errors, and 5xx responses.
- A single cumulative deadline covers retries and provider hops.
- Successful read operations include `failedOverFrom` with provider, operation, reason, and retryability.
- Authentication, permission, invalid input, and unsupported-option errors do not retry on the same provider.
- Never automatically replay a session callback after it clicked, typed, submitted a form, or caused another side effect.

## Sessions and secrets

Keep provider keys and cloud `connectUrl` values server-side. Browserbase and Steel may include credentials in connection URLs. Use `withSession()` for automatic cleanup or call `session.close()` when using `createSession()` directly.

```ts
import { chromium } from "playwright-core";

await browser.withSession({}, async (session) => {
  const remote = await chromium.connectOverCDP(session.connectUrl!);
  try {
    const page = remote.contexts()[0].pages()[0];
    await page.goto("https://example.com");
  } finally {
    await remote.close();
  }
});
```

Use deterministic Playwright locators and web-first assertions for known workflows. Reserve model-driven actions for ambiguity. Browserbase Fetch is raw HTTP retrieval, so use it for `content`/derived Markdown only; it does not advertise structured extraction. Browserless sessions are created through its REST Session API and must be closed so its private stop URL can be used.

## Agent tools and MCP

For an agent inside your application:

```ts
import { createBrowserTools } from "@soulsniper-v2/browser-sdk/agent-tools";
const tools = createBrowserTools(browser);
```

For an MCP client:

```bash
npx -y @soulsniper-v2/browser-sdk-mcp
```

The MCP server exposes both stateless read tools and an explicit stateful browser runtime. Use Markdown, extract, links, route, snapshot, and crawl for read-only context. When the agent must operate a browser itself, use this sequence:

```text
browser_session_start
browser_session_navigate
browser_session_snapshot
browser_session_action
browser_session_snapshot
browser_session_read or browser_session_screenshot
browser_session_close
```

The session tools keep CDP URLs and provider credentials inside the MCP process and return only an opaque runtime id. Use the `e1`/`e2` refs from the latest snapshot. Stateful actions are never retried, replayed, or automatically failed over. Set `BROWSER_SDK_ALLOWED_DOMAINS` for a navigation allowlist and `BROWSER_SDK_MAX_SESSIONS` to cap concurrency.

The package CLI is useful for quick, non-interactive checks:

```bash
npx @soulsniper-v2/browser-sdk https://example.com
npx @soulsniper-v2/browser-sdk route markdown
npx @soulsniper-v2/browser-sdk doctor
```

## Testing

Use the memory provider for network-free tests:

```ts
import { createBrowserClient } from "@soulsniper-v2/browser-sdk";
import { memoryProvider } from "@soulsniper-v2/browser-sdk/testing";

const browser = createBrowserClient({
  providers: [memoryProvider({ content: "<h1>fixture</h1>" })],
});
```

Test provider request mapping with an injected `fetch` function. A passing mock test proves adapter behavior, not live provider authentication.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Check that no secrets enter browser bundles or agent tool output. If provider behavior changes, update `docs/providers.md`, the relevant README section, this skill, `examples/mcp.json`, and the MCP server together.
