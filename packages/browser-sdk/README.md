# browser-sdk

Provider-neutral browser infrastructure for TypeScript. Start with Browserbase, fall through Cloudflare Browser Run, Browserless, Steel, optional extended cloud adapters, or local Playwright, and keep one typed caller.

```bash
npm install browser-sdk
```

```ts
import { fromEnv } from "browser-sdk";

const browser = fromEnv();
const result = await browser.markdown("https://example.com");

console.log(result.markdown);
console.log(`via ${result.provider} in ${result.latencyMs}ms`);
```

## Public methods

| Method | Purpose |
| :--- | :--- |
| `content(source, options?)` | Render HTML from a URL or inline HTML. |
| `markdown(source, options?)` | Return Markdown for model context. |
| `screenshot(source, options?)` | Return image bytes. |
| `pdf(source, options?)` | Return PDF bytes. |
| `snapshot(source, options?)` | Return several page representations in one request. |
| `accessibilityTree(source, options?)` | Return an accessibility tree when supported. |
| `extract(source, options)` | Return provider-extracted JSON. |
| `links(source, options?)` | Return links from the rendered page. |
| `crawl(source, options?)` | Run a bounded crawl when supported. |
| `createSession(options?)` | Create a session handle. |
| `withSession(options, callback)` | Create, run, and clean up a session. |
| `routePreview(capability)` | Inspect candidates without making a provider call. |

## Provider subpaths

```ts
import { browserbase } from "browser-sdk/browserbase";
import { cloudflare } from "browser-sdk/cloudflare";
import { browserless } from "browser-sdk/browserless";
import { steel } from "browser-sdk/steel";
import { anchor } from "browser-sdk/anchor";
import { hyperbrowser } from "browser-sdk/hyperbrowser";
import { browserUse } from "browser-sdk/browser-use";
import { local } from "browser-sdk/local";
```

The package also exports `browser-sdk/testing` for the isolated memory provider and `browser-sdk/agent-tools` for plain JSON Schema model tools.

## Agent skill and CLI

Browser SDK has two surfaces: import the package in your application, or install the repository skill and MCP server when an agent should learn and operate the browser itself. The skill points agents at the machine-readable docs; MCP keeps an explicit browser session alive across tool calls.

Install the coding-agent skill from the repository so agents know when to use the SDK, how failover works, and how to verify provider changes:

```bash
npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk
```

The package is also executable through `npx` for one-off page reads and local configuration checks. The CLI uses `BROWSER_SDK_EXTENDED_PROVIDERS=true` when you want the extended providers included:

```bash
npx browser-sdk https://example.com
npx browser-sdk route markdown
npx browser-sdk doctor
```

## Provider order

`fromEnv()` uses Browserbase, Cloudflare Browser Run, Browserless, Steel, and local in that order. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` to append Anchor Browser, Hyperbrowser, and Browser Use Cloud before local. A provider is only included when its key and required identifiers exist. Pass explicit `providers` when you need a different order.

## Safety contract

- Provider calls use one cumulative deadline.
- Retryable failures retry on the same provider before a failover hop.
- Successful results explain the provider and every previous hop.
- Unsupported operations and options fail explicitly.
- `withSession()` cleans up in a `finally` block.
- Session callbacks are never replayed automatically after side effects.
- Error details redact bearer tokens, keys, passwords, and cookies.

The main documentation lives in [`../../docs`](../../docs) and at the project site.

This package is most useful when an application already has multiple browser accounts or vendors to route across. It is a client-side routing layer, not a hosted browser gateway; see [`../../docs/positioning.md`](../../docs/positioning.md) for the honest tradeoffs.
