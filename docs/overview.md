---
title: Browser SDK
description: One typed TypeScript client for browser sessions, rendering, and provider failover.
---

Browser SDK keeps browser infrastructure out of the rest of your application. Configure Browserbase first, Cloudflare Browser Run next, then any other adapters you have. Your caller keeps the same method and receives the provider, latency, and failover trail that produced the result.

```ts
import { fromEnv } from "browser-sdk";

const browser = fromEnv();
const page = await browser.markdown("https://docs.example.com");
console.log(page.markdown, page.provider, page.latencyMs);
```

## Choose your depth

- `markdown()` for model context.
- `content()` for rendered HTML.
- `screenshot()` and `pdf()` for artifacts.
- `snapshot()` for multiple representations in one call.
- `extract()` for provider-backed JSON.
- `createSession()` or `withSession()` for live Playwright, Puppeteer, Selenium, or CDP work.
- `createBrowserTools()` or the MCP server for agent tool loops.

Read [Quickstart](quickstart.md), then [Providers](providers.md).
