---
title: Browser SDK documentation
description: One typed browser API for sessions, rendered artifacts, and provider failover.
---

Browser SDK is a provider-neutral TypeScript client for browser sessions, rendered page artifacts, and model-ready context.

## Start here

- [Quickstart](quickstart.md) for the first request.
- [Providers](providers.md) for the adapter matrix and capabilities.
- [Routing and failover](routing.md) for retries, deadlines, and safe boundaries.

## Choose a surface

| Need | Call |
| :--- | :--- |
| Model context | `browser.markdown(url)` |
| Rendered HTML | `browser.content(url)` |
| Screenshot or PDF | `browser.screenshot(url)` or `browser.pdf(url)` |
| Structured fields | `browser.extract(url, { schema })` |
| Interactive browser | `browser.withSession(options, callback)` |
| Agent tool loop | `createBrowserTools(browser)` or the MCP server |

The default route is Browserbase, Cloudflare Browser Run, Browserless, Steel, then local. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` to add Anchor Browser, Hyperbrowser, and Browser Use Cloud before local. The client skips providers that do not have the capability a call requires.
