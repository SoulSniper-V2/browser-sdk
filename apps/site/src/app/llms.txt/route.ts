import { docsIndexLines } from "@/lib/llms";
import { SITE_URL, TEXT_HEADERS } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const body = `# Browser SDK

> One typed TypeScript client for browser sessions, rendering, agent context, and provider failover.

## Agent install

- Skill: \`npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk\`
- MCP: \`npx -y @soulsniper-v2/browser-sdk-mcp\`
- CLI: \`npx @soulsniper-v2/browser-sdk https://example.com\`

## Product facts

- Package: \`browser-sdk\`
- MCP package: \`@soulsniper-v2/browser-sdk-mcp\`
- Default route: Browserbase, Cloudflare Browser Run, Browserless, Steel, local
- Extended route (opt in with \`BROWSER_SDK_EXTENDED_PROVIDERS=true\`): Anchor Browser, Hyperbrowser, Browser Use Cloud, then local
- Core operations: sessions, content, Markdown, screenshots, PDFs, snapshots, accessibility, extraction, links, crawl
- Agent runtime: stateful MCP sessions with navigate, snapshot refs, explicit actions, read, screenshot, and close
- Safety: credentials stay server-side; side-effecting session callbacks are never replayed automatically

## Documentation

${docsIndexLines()}

## Machine-readable

- [Complete docs](${SITE_URL}/llms-full.txt)
- [JSONL page feed](${SITE_URL}/feeds/docs.jsonl)
- [Schema map](${SITE_URL}/schemamap.xml)
- [Agent skill](${SITE_URL}/skills/browser-sdk/SKILL.md)
`;
  return new Response(body, { headers: TEXT_HEADERS });
}
