# Changelog

## Unreleased

- Added first-class Fumadocs MDX documentation sourced from `docs/`.
- Added `npx @soulsniper-v2/browser-sdk <url>`, `doctor`, and `skill` CLI commands.
- Added the visible `npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk` install path and hosted raw skill route.
- Added a stateful MCP browser runtime with session start, navigation, accessibility refs, explicit actions, reads, screenshots, allowlists, and cleanup.
- Reworked the homepage around a clean route-first product story with a repaired logo, transparent hero art, and restrained motion.
- Added opt-in Anchor Browser, Hyperbrowser, and Browser Use Cloud session adapters with environment-based routing.
- Corrected Browserbase Fetch, Cloudflare DevTools sessions, Browserless REST sessions, and Steel artifact/session mappings against current provider APIs.
- Hardened unsupported-option handling, local session cleanup, provider-pinned close operations, and browser hydration diagnostics.

## 0.1.0

- Added the provider-neutral browser client.
- Added Browserbase, Cloudflare Browser Run, Browserless, Steel, and local adapters.
- Added session helpers, cumulative retries, failover trails, typed errors, CLI, memory provider, and agent tools.
- Added the stdio MCP server, agent skill, docs site, raw Markdown docs, LLM index, JSONL feed, and schema map.
