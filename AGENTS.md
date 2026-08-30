# Browser SDK repository

## Start with the machine-readable docs

Before making a change, read `README.md`, `packages/browser-sdk/README.md`, the relevant `docs/*.md`, and `packages/browser-sdk/src/types.ts`. The site publishes the same surface through `/llms.txt`, `/llms-full.txt`, `/feeds/docs.jsonl`, `/schemamap.xml`, and `/docs/<page>.md`.

## Core boundaries

- Keep provider credentials in server-side code.
- Preserve the default route: Browserbase, Cloudflare Browser Run, Browserless, Steel, local.
- Add a capability declaration before adding an adapter method.
- Retry only retryable errors. Do not replay a side-effecting session callback.
- Keep `failedOverFrom`, provider, latency, and typed errors observable.
- Reject unsupported options instead of silently dropping them.
- Prefer injected `fetch` and the memory provider for tests.
- Do not claim a live provider was tested when only request mapping was tested.

## Site and agent surfaces

- Keep the site visual system dark charcoal, off-white, and one lime accent.
- The hero asset must remain a transparent cutout. Do not replace it with a collage or fake browser screenshot.
- Keep the site docs and static machine-readable files in sync with `docs/`.
- Update `skills/browser-sdk/SKILL.md`, `skills/browser-sdk/mcp.json`, `examples/mcp.json`, and the MCP server when tool behavior changes.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

When the Next.js server is running, verify the site in a real browser at `http://localhost:4173`: home, `/docs` Fumadocs navigation, theme toggle, copy buttons, route preview, agent install command, and raw machine docs.
