---
title: API reference
description: Public Browser SDK types and methods.
---

## Client creation

```ts
createBrowserClient(config: BrowserClientConfig): BrowserClient
fromEnv(options?: FromEnvOptions): BrowserClient
```

`BrowserClientConfig` accepts `providers`, `provider`, `fallback`, `timeoutMs`, `retries`, `strategy`, `cache`, `fetch`, `logger`, and `onFailover`.

Built-in factories are available from the package root and subpaths: `browserbase`, `cloudflare`, `browserless`, `steel`, `local`, `anchor`, `hyperbrowser`, and `browserUse`.

`fromEnv()` keeps the default Browserbase → Cloudflare Browser Run → Browserless → Steel → local order. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` (or `includeExtendedProviders: true`) to add Anchor Browser → Hyperbrowser → Browser Use Cloud before local.

## Methods

```ts
client.providers()
client.supports(capability)
client.routePreview(capability)
client.createSession(options?)
client.getSession(provider, id)
client.listSessions(options?)
client.content(source, options?)
client.markdown(source, options?)
client.screenshot(source, options?)
client.pdf(source, options?)
client.snapshot(source, options?)
client.accessibilityTree(source, options?)
client.extract(source, { prompt?, schema? })
client.links(source, options?)
client.crawl(source, options?)
client.withSession(options, callback)
```

`source` is a URL string, `{ url }`, or `{ html }` where the selected provider supports inline HTML.

Provider adapters declare capabilities. A provider is never selected for an operation it does not advertise, and a generic option that an adapter cannot honor produces `UnsupportedOptionError` instead of being silently dropped.

## Errors

Import `BrowserSdkError`, `RateLimitError`, `TimeoutError`, `CapabilityError`, `UnsupportedOptionError`, and `AllProvidersFailedError` from `browser-sdk`. Every owned error has a stable `code`, optional `provider`, optional `statusCode`, `retryable`, and redacted `details`.
