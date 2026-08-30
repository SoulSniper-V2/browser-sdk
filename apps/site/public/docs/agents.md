---
title: Agent tools
description: Give model loops a small, typed browser surface.
---

`@soulsniper-v2/browser-sdk/agent-tools` exports framework-neutral tools with plain JSON Schema. There is no model-provider dependency.

```ts
import { createBrowserTools } from "@soulsniper-v2/browser-sdk/agent-tools";

const tools = createBrowserTools(browser);
```

The tools are:

| Tool | Use |
| :--- | :--- |
| `browser_markdown` | Read a rendered page as Markdown. |
| `browser_content` | Read rendered HTML when markup is required. |
| `browser_extract` | Extract structured data from a prompt or JSON Schema. |
| `browser_links` | Discover links from a rendered page. |
| `browser_route` | Explain which providers can perform an operation. |
| `browser_providers` | Inspect configured adapters, capabilities, and relative costs. |
| `browser_snapshot` | Return multiple page representations when a snapshot provider exists. |
| `browser_crawl` | Run a bounded crawl when a crawl provider exists. |

Adapt `inputSchema` and `execute` to your model SDK. Keep action tools separate from read tools. Known workflows should use deterministic locators and assertions, while model-driven actions should be reserved for ambiguity.

## Install the coding-agent skill

The repository also ships a procedural skill that tells coding agents when to use the SDK, how to route calls, how to keep credentials safe, and how to verify changes.

```bash
npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk
```

The raw skill is always available at `/skills/browser-sdk/SKILL.md`. If the Skills CLI is not installed, copy that file into your agent's skills directory as `browser-sdk/SKILL.md`.

## Two ways to use Browser SDK

There are two deliberately separate layers:

1. **The SDK** is for application code. Import `browser-sdk`, configure `fromEnv()`, and keep browser work behind your own authorization and workflow code.
2. **The agent layer** is for an agent operating the browser itself. Install the skill for procedural guidance, use the CLI for one-off checks, or connect the MCP server for a stateful browser session.

The skill tells the agent to read `/llms.txt` first, use `/llms-full.txt` or a raw page when exact details are needed, inspect `browser_route` before choosing a surface, and never replay a side-effecting action after a provider error.

The standard `fromEnv()` runway is Browserbase → Cloudflare Browser Run → Browserless → Steel → local. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` to add Anchor Browser → Hyperbrowser → Browser Use Cloud before local.

The MCP session workflow is explicit:

```text
browser_session_start
  -> browser_session_navigate
  -> browser_session_snapshot   (read e1/e2 refs)
  -> browser_session_action     (one explicit click/fill/type/etc.)
  -> browser_session_snapshot   (refs are refreshed)
  -> browser_session_read or browser_session_screenshot
  -> browser_session_close
```

The server keeps CDP URLs and provider credentials inside its own process. It returns only an opaque runtime session id. Set `BROWSER_SDK_ALLOWED_DOMAINS` to constrain navigation and `BROWSER_SDK_MAX_SESSIONS` to cap concurrent sessions.

## Use the CLI

The package itself is runnable through `npx` for quick reads and route inspection:

```bash
npx @soulsniper-v2/browser-sdk https://example.com
npx @soulsniper-v2/browser-sdk route markdown
npx @soulsniper-v2/browser-sdk doctor
```
