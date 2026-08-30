---
title: Quickstart
description: Install the package and make a provider-neutral browser call.
---

## Install

```bash
npm install @soulsniper-v2/browser-sdk
# Optional, for local browser sessions:
npm install playwright-core
```

## Create the client

```ts
import { fromEnv } from "@soulsniper-v2/browser-sdk";

const browser = fromEnv({
  timeoutMs: 30_000,
  retries: 1,
  strategy: "priority",
});
```

`fromEnv()` reads:

- `BROWSERBASE_API_KEY` and optional `BROWSERBASE_PROJECT_ID`
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
- `BROWSERLESS_API_KEY` or `BROWSERLESS_TOKEN`
- `STEEL_API_KEY`
- `ANCHOR_API_KEY`
- `HYPERBROWSER_API_KEY`
- `BROWSER_USE_API_KEY`
- `CHROMIUM_EXECUTABLE_PATH` for local Playwright

The default order is Browserbase, Cloudflare Browser Run, Browserless, Steel, then local. Providers without credentials are skipped. Local is included unless `includeLocal: false` is passed.

For an extended route, set `BROWSER_SDK_EXTENDED_PROVIDERS=true` or pass `includeExtendedProviders: true`. The additional order is Anchor Browser, Hyperbrowser, Browser Use Cloud, then local.

## Read a page

```ts
const page = await browser.markdown("https://news.ycombinator.com", {
  waitForSelector: "body",
  maxChars: 20_000,
  cache: true,
});

console.log(page.markdown);
console.log(page.provider, page.latencyMs, page.failedOverFrom);
```

## Capture an artifact

```ts
const screenshot = await browser.screenshot("https://example.com", {
  fullPage: true,
  format: "png",
});

await writeFile("page.png", screenshot.data);
```

## Inspect the route without making a call

```ts
console.log(browser.routePreview("screenshot"));
```

## Use the package through `npx`

For a one-off page read or a route check, the package exposes a small CLI:

```bash
npx @soulsniper-v2/browser-sdk https://example.com
npx @soulsniper-v2/browser-sdk markdown https://example.com
npx @soulsniper-v2/browser-sdk route markdown
npx @soulsniper-v2/browser-sdk doctor
```

The CLI uses the same environment variables and provider order as `fromEnv()`. It never sends a provider request for `route` or `doctor`.
