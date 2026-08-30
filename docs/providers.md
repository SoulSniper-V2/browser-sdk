---
title: Providers
description: Adapter capabilities and the provider APIs they call.
---

## Provider matrix

| Provider | Session | HTML | Markdown | Screenshot | PDF | Extract | Crawl |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Browserbase | yes | yes | yes | no | no | no | no |
| Cloudflare Browser Run | yes | yes | yes | yes | yes | prompt or schema | yes |
| Browserless | yes | yes | yes | yes | yes | no | no |
| Steel | yes | yes | yes | yes | yes | no | no |
| Local Playwright | yes | yes | yes | yes | yes | no | no |
| Anchor Browser | yes | no | no | no | no | no | no |
| Hyperbrowser | yes | no | no | no | no | no | no |
| Browser Use Cloud | yes | no | no | no | no | no | no |

## Browserbase

The adapter creates sessions through `POST /v1/sessions`, returns the provider CDP URL, and releases sessions with `POST /v1/sessions/:id` using `REQUEST_RELEASE`. Read-only content uses [Browserbase Fetch](https://docs.browserbase.com/platform/fetch/overview), which returns raw HTTP content and does not currently expose Markdown or JSON extraction; the adapter derives Markdown locally and does not advertise `extract`. `browserbase()` accepts `apiKey`, `projectId`, and `baseUrl`.

## Cloudflare Browser Run

The adapter uses [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/) for content, Markdown, screenshots, PDFs, snapshots, accessibility trees, JSON, links, and crawl. Live sessions use the [DevTools browser API](https://developers.cloudflare.com/browser-run/cdp/session-management/) to acquire a real session id, connect over CDP, list/inspect sessions, and delete them. `cloudflare()` accepts `apiToken`, `accountId`, and `baseUrl`.

## Browserless

The adapter uses the standalone REST endpoints for content, screenshots, and PDFs. Live sessions use Browserless's [persistent Session API](https://docs.browserless.io/baas/session-management/persisting-state) (`POST /session`) and retain its returned `connect` and `stop` URLs privately so cleanup can issue the documented `DELETE`. `browserless()` accepts `token` and an optional `baseUrl` for a self-hosted deployment.

## Steel

The adapter uses [Steel's Sessions API](https://docs.steel.dev/overview/sessions-api/session-lifecycle) and one-shot `/v1/scrape`, `/v1/screenshot`, and `/v1/pdf` endpoints. Hosted screenshot and PDF URLs are fetched and returned as bytes so the public SDK result is consistent. `steel()` accepts `apiKey`, `baseUrl`, and `connectUrl`.

## Local

The local adapter uses ordinary `fetch` for HTML and Markdown and optional `playwright-core` for browser sessions and artifacts. Pass `executablePath` when the machine does not have a discoverable Chromium binary.

## Extended cloud adapters

The extended adapters are opt-in in `fromEnv()` because adding credentials should not silently change an existing route. Enable them with `BROWSER_SDK_EXTENDED_PROVIDERS=true` or `includeExtendedProviders: true`.

### Anchor Browser

Uses [Anchor's browser session APIs](https://docs.anchorbrowser.io/quickstart/browser-sessions): `POST /v1/sessions`, `GET /v1/sessions/:id`, paginated `GET /v1/sessions`, and `DELETE /v1/sessions/:id`. Generic timeout, idle timeout, proxy, viewport, recording, stealth, CAPTCHA solving, headless, and metadata options map to Anchor's documented nested session/browser configuration. `anchor()` accepts `apiKey` and `baseUrl`.

### Hyperbrowser

Uses [Hyperbrowser's session API](https://www.hyperbrowser.ai/docs/api-reference/create-new-session): `/api/session`, `/api/session/:id`, `/api/sessions`, and `/api/session/:id/stop` endpoints. It maps profiles, region, timeouts, proxy, viewport, recording, logs, stealth, CAPTCHA solving, and outbound allowlists. `hyperbrowser()` accepts `apiKey` and `baseUrl`.

### Browser Use Cloud

Uses [Browser Use Cloud API v3](https://docs.browser-use.com/cloud/api-v3/browsers/create-browser-session) standalone browser sessions: `POST /api/v3/browsers`, `GET /api/v3/browsers/:id`, paginated `GET /api/v3/browsers`, and `PATCH /api/v3/browsers/:id` with `{ action: "stop" }`. It maps profiles, country-based proxy routing, custom proxies, timeouts, viewport, recording, and stringified metadata. `browserUse()` accepts `apiKey` and `baseUrl`.
