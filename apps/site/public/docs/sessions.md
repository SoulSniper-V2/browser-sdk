---
title: Sessions
description: Connect your browser library to whichever provider wins the route.
---

```ts
import { fromEnv } from "@soulsniper-v2/browser-sdk";
import { chromium } from "playwright-core";

const browser = fromEnv();

await browser.withSession(
  { keepAlive: true, metadata: { workflow: "checkout" } },
  async (session) => {
    if (!session.connectUrl) throw new Error("This provider did not return a CDP URL.");
    const remote = await chromium.connectOverCDP(session.connectUrl);
    const page = remote.contexts()[0].pages()[0];
    await page.goto("https://example.com");
    console.log(await page.title(), session.provider);
    await remote.close();
  },
);
```

## Session fields

- `id`: provider session id or local id.
- `provider`: the adapter that created the session.
- `connectUrl`: CDP WebSocket URL for cloud sessions.
- `native`: local Playwright browser, context, and page for the local adapter.
- `debuggerUrl` and `dashboardUrl`: links when the provider returns them.
- `metadata`: user metadata passed at creation time.

## Cleanup

`withSession()` calls `close()` in a `finally` block. When you use `createSession()` directly, close it explicitly. Cloud browser minutes and concurrency remain in use until a session closes or reaches its timeout.

Cloud providers have different session limits. Keep session timeouts bounded and reuse a session when a workflow has several tabs or steps.

The default session route is Browserbase → Cloudflare Browser Run → Browserless → Steel → local. The extended route adds Anchor Browser, Hyperbrowser, and Browser Use Cloud before local when `BROWSER_SDK_EXTENDED_PROVIDERS=true`.

Provider cleanup is pinned to the creating adapter. Browserbase uses `REQUEST_RELEASE`, Cloudflare deletes its DevTools browser session, Browserless deletes its returned stop URL, Steel releases `/v1/sessions/:id/release`, and the extended adapters call their documented stop/delete endpoint.

## MCP sessions

The MCP package provides the same idea for an agent-owned workflow without exposing the provider's CDP URL to the model. Start with `browser_session_start`, use `browser_session_snapshot` to receive short-lived accessibility refs, perform one action with `browser_session_action`, then snapshot again. Close with `browser_session_close`.

Set `BROWSER_SDK_ALLOWED_DOMAINS` when the MCP process should only navigate a known set of hostnames. Set `CHROMIUM_EXECUTABLE_PATH` when the final local fallback uses `playwright-core` without a discoverable browser.
