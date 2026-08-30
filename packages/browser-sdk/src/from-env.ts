import { createBrowserClient } from "./client.js";
import type { BrowserClient, BrowserClientConfig, BrowserProvider, CacheConfig } from "./types.js";
import { anchor } from "./providers/anchor.js";
import { browserbase } from "./providers/browserbase.js";
import { browserUse } from "./providers/browser-use.js";
import { browserless } from "./providers/browserless.js";
import { cloudflare } from "./providers/cloudflare.js";
import { hyperbrowser } from "./providers/hyperbrowser.js";
import { local } from "./providers/local.js";
import { steel } from "./providers/steel.js";

export interface FromEnvOptions extends Omit<BrowserClientConfig, "providers" | "provider" | "fallback" | "cache"> {
  cache?: boolean | CacheConfig;
  includeLocal?: boolean;
  includeExtendedProviders?: boolean;
  local?: Parameters<typeof local>[0];
  anchor?: Partial<Omit<Parameters<typeof anchor>[0], "apiKey">>;
  browserbase?: Partial<Omit<Parameters<typeof browserbase>[0], "apiKey">>;
  browserUse?: Partial<Omit<Parameters<typeof browserUse>[0], "apiKey">>;
  cloudflare?: Partial<Omit<Parameters<typeof cloudflare>[0], "apiToken" | "accountId">>;
  browserless?: Partial<Omit<Parameters<typeof browserless>[0], "token">>;
  hyperbrowser?: Partial<Omit<Parameters<typeof hyperbrowser>[0], "apiKey">>;
  steel?: Partial<Omit<Parameters<typeof steel>[0], "apiKey">>;
}

/**
 * Build the default provider runway from environment variables.
 * The default order is Browserbase, Cloudflare Browser Run, Browserless, Steel,
 * then local. Set includeExtendedProviders to add Anchor, Hyperbrowser, and
 * Browser Use Cloud between Steel and local.
 */
export function fromEnv(options: FromEnvOptions = {}): BrowserClient {
  const providers: BrowserProvider[] = [];
  const browserbaseKey = process.env.BROWSERBASE_API_KEY;
  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const cloudflareAccount = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const browserlessToken = process.env.BROWSERLESS_API_KEY ?? process.env.BROWSERLESS_TOKEN;
  const steelKey = process.env.STEEL_API_KEY;
  const anchorKey = process.env.ANCHOR_API_KEY;
  const hyperbrowserKey = process.env.HYPERBROWSER_API_KEY;
  const browserUseKey = process.env.BROWSER_USE_API_KEY;

  if (browserbaseKey) providers.push(browserbase({ apiKey: browserbaseKey, projectId: process.env.BROWSERBASE_PROJECT_ID, ...options.browserbase }));
  if (cloudflareToken && cloudflareAccount) providers.push(cloudflare({ apiToken: cloudflareToken, accountId: cloudflareAccount, ...options.cloudflare }));
  if (browserlessToken) providers.push(browserless({ token: browserlessToken, ...options.browserless }));
  if (steelKey) providers.push(steel({ apiKey: steelKey, ...options.steel }));
  const includeExtendedProviders = options.includeExtendedProviders ?? process.env.BROWSER_SDK_EXTENDED_PROVIDERS === "true";
  if (includeExtendedProviders) {
    if (anchorKey) providers.push(anchor({ apiKey: anchorKey, ...options.anchor }));
    if (hyperbrowserKey) providers.push(hyperbrowser({ apiKey: hyperbrowserKey, ...options.hyperbrowser }));
    if (browserUseKey) providers.push(browserUse({ apiKey: browserUseKey, ...options.browserUse }));
  }
  if (options.includeLocal !== false) {
    providers.push(local({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      ...options.local,
    }));
  }

  const {
    includeLocal: _includeLocal,
    includeExtendedProviders: _includeExtendedProviders,
    local: _local,
    anchor: _anchor,
    browserbase: _browserbase,
    browserUse: _browserUse,
    cloudflare: _cloudflare,
    browserless: _browserless,
    hyperbrowser: _hyperbrowser,
    steel: _steel,
    cache,
    ...clientOptions
  } = options;

  return createBrowserClient({
    ...clientOptions,
    providers,
    cache: cache ?? { ttlMs: 60_000, maxEntries: 200 },
  });
}
