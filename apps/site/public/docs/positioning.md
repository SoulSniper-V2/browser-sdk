---
title: Positioning
description: Where Browser SDK is useful, where it overlaps, and what it is not.
---

## The honest answer

Yes, this is useful for a team that already has two or more browser providers and wants one typed integration, a deterministic fallback route, and an agent surface that does not leak provider credentials. It is not a new category by itself.

Provider-specific SDKs already exist for Browserbase, Browserless, Steel, Cloudflare Browser Run, Anchor Browser, Hyperbrowser, and Browser Use Cloud. Playwright also has an official MCP server for agent-controlled browsers. A separate open-source project, [browser-gateway](https://github.com/browser-gateway/browser-gateway), is an even closer product overlap: it presents itself as a multi-provider browser control plane with failover, profiles, replays, REST, MCP, and a dashboard.

## Where this project fits

Browser SDK is intentionally smaller and closer to application code:

- It is an in-process TypeScript client, not a network gateway that every browser connection must pass through.
- It unifies one-shot artifacts and live sessions behind one capability-aware interface.
- It preserves the caller's configured route and attaches typed failure hops to successful read results.
- It ships a framework-neutral JSON Schema tool layer, a stateful stdio MCP runtime, a coding-agent skill, and machine-readable docs.
- It lets a team keep the providers it already pays for instead of introducing another hosted control plane.

That makes it a good fit for a backend, agent runtime, scraper, test runner, or internal platform that needs resilience without adding a second service to operate.

## When it is worth using

Use it when provider quotas, regional availability, cold starts, price, or outages materially affect your workflow. The clearest first use case is read-only work such as Markdown, HTML, links, screenshots, PDFs, extraction, and bounded crawls, because those operations are safe to retry and fail over.

For side-effecting workflows, use one pinned session and make the resume policy part of the application. The SDK deliberately does not replay clicks, typing, submissions, or a session callback on another provider.

## What it does not solve yet

The SDK reacts to provider errors; it does not know a vendor's remaining quota before a request, and it does not promise identical fingerprints, browser versions, profiles, or anti-bot behavior across vendors. Relative adapter costs are routing hints, not live vendor prices. Production teams should add provider-specific smoke tests, budget alerts, and a conformance suite for the sites that matter.

## Verdict

This is a good open-source building block, especially if the goal is “one browser contract, several accounts, honest failover.” It is not enough to win as a generic hosted browser platform while it only offers adapters. The strongest differentiation is the combination of a lightweight TypeScript API, explicit safety boundaries, provider conformance, and a genuinely useful agent package. The next product-level bets would be live health/cooldown signals, provider budget policies, and stronger session portability—not simply more adapters.
