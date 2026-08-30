---
title: MCP server
description: Run Browser SDK as a stdio MCP server.
---

```bash
npm install @soulsniper-v2/browser-sdk-mcp
npx -y @soulsniper-v2/browser-sdk-mcp
```

Configuration:

```json
{
  "mcpServers": {
    "browser-sdk": {
      "command": "npx",
      "args": ["-y", "@soulsniper-v2/browser-sdk-mcp"],
      "env": {
        "BROWSERBASE_API_KEY": "bb_...",
        "CLOUDFLARE_API_TOKEN": "...",
        "CLOUDFLARE_ACCOUNT_ID": "...",
        "BROWSERLESS_API_KEY": "...",
        "STEEL_API_KEY": "...",
        "ANCHOR_API_KEY": "...",
        "HYPERBROWSER_API_KEY": "...",
        "BROWSER_USE_API_KEY": "...",
        "BROWSER_SDK_EXTENDED_PROVIDERS": "true"
      }
    }
  }
}
```

## Read tools

The server registers `browser_markdown`, `browser_extract`, `browser_links`, `browser_route`, and `browser_snapshot`. `browser_crawl` is registered when a crawl-capable provider is configured. These are stateless provider-neutral calls and can fail over according to the SDK route.

## Stateful browser tools

The server also exposes a session runtime for agents that need to operate a browser themselves:

| Tool | Purpose |
| :--- | :--- |
| `browser_session_start` | Start a browser with optional profile, region, proxy, viewport, stealth, and recording settings; return an opaque runtime id. |
| `browser_session_list` | List active runtime sessions without secrets. |
| `browser_session_navigate` | Navigate one existing session. |
| `browser_session_snapshot` | Return page context and short-lived `e1`, `e2` action refs. |
| `browser_session_read` | Read visible text from the page or one ref/selector. |
| `browser_session_action` | Explicitly click, fill, type, press, select, check, hover, wait, or scroll. |
| `browser_session_screenshot` | Return screenshot image content from the session. |
| `browser_session_close` | Release the session and provider resources. |

Use a fresh `browser_session_snapshot` after navigation or an action because refs are page-state-specific. Stateful actions are never retried, replayed, or silently moved to another provider.

The runtime keeps CDP connection URLs and provider credentials inside the MCP process. It returns only an opaque runtime id. Set `BROWSER_SDK_ALLOWED_DOMAINS` to constrain navigation and `BROWSER_SDK_MAX_SESSIONS` to cap concurrent sessions.

When the route reaches the local provider, `playwright-core` needs a discoverable Chromium executable. Set `CHROMIUM_EXECUTABLE_PATH` in the MCP environment when necessary.

For side-effecting browser work, the MCP client must still have authorization and confirmation boundaries in the surrounding application or agent workflow. The tool description makes the mutation explicit; the server does not decide whether a click or submission is appropriate.
