---
title: Routing and failover
description: Retry transient failures on the same provider, then move down the runway.
---

## The algorithm

1. Validate the source and operation options.
2. Select providers that declare the needed capability.
3. Order candidates by `priority` or relative `cost`.
4. Run the provider with one cumulative deadline.
5. Retry retryable errors on the same provider.
6. Move to the next capable provider after retries are exhausted.
7. Attach the failure trail to a successful result, or throw `AllProvidersFailedError`.

`fromEnv()` preserves a conservative default runway: Browserbase → Cloudflare Browser Run → Browserless → Steel → local. Add `BROWSER_SDK_EXTENDED_PROVIDERS=true` when you also want Anchor Browser → Hyperbrowser → Browser Use Cloud before local. Explicit `providers` always win when you need a different order.

## Retryable errors

The client can retry rate limits, 408 responses, 5xx responses, network errors, and SDK timeouts. It uses `Retry-After` when a provider supplies it. Authentication, permission, invalid input, and unsupported-option errors are not retried on the same provider.

```ts
const page = await browser.markdown(url);

page.failedOverFrom;
// [{
//   provider: "browserbase",
//   operation: "markdown",
//   reason: "rate_limit",
//   retryable: true
// }]
```

## Side-effect boundary

Read-only methods can fail over. A callback passed to `withSession()` is not automatically replayed after it has clicked, typed, submitted a form, or otherwise caused a side effect. The application decides whether and how to resume. `session.close()` stays pinned to the provider that created the session so cleanup cannot accidentally release a different provider's id.

Use `onFailover` for metrics and logs. Error messages and details redact credentials.
