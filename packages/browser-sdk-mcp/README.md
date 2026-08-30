# @soulsniper-v2/browser-sdk-mcp

[![npm version](https://img.shields.io/npm/v/%40soulsniper-v2%2Fbrowser-sdk-mcp.svg)](https://www.npmjs.com/package/@soulsniper-v2/browser-sdk-mcp)

MCP server for [Browser SDK](../../packages/browser-sdk/README.md). It gives Codex, Claude Code, Cursor, and other MCP clients a small browser tool surface backed by the same provider runway as the TypeScript client.

```bash
npm install @soulsniper-v2/browser-sdk-mcp
npx -y @soulsniper-v2/browser-sdk-mcp
```

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

Read tools are `browser_markdown`, `browser_extract`, `browser_links`, `browser_route`, `browser_snapshot`, and `browser_crawl` when a crawl-capable provider is configured.

For agents that need to operate a browser, the server also provides a stateful runtime:

```text
browser_session_start
browser_session_navigate
browser_session_snapshot
browser_session_action
browser_session_read / browser_session_screenshot
browser_session_close
```

Snapshots return short-lived `e1`, `e2`, and similar refs. Re-snapshot after navigation or an action. Session actions are explicit side effects and are never retried, replayed, or failed over. The MCP process keeps provider CDP URLs and credentials private and returns only an opaque runtime id.

Optional safety controls:

```bash
BROWSER_SDK_ALLOWED_DOMAINS=example.com,docs.example.com
BROWSER_SDK_MAX_SESSIONS=4
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium
```

The default MCP route is Browserbase → Cloudflare Browser Run → Browserless → Steel → local. `BROWSER_SDK_EXTENDED_PROVIDERS=true` adds Anchor Browser → Hyperbrowser → Browser Use Cloud before local.

For application-owned browser work, use `withSession()` directly where authorization and cleanup are visible in application code.

Provider credentials are read from the environment and are never returned in tool output.
