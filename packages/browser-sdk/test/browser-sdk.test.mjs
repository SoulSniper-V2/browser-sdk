import test from "node:test";
import assert from "node:assert/strict";
import {
  AllProvidersFailedError,
  BrowserSdkError,
  createBrowserClient,
  fromEnv,
  redact,
} from "../dist/index.js";
import { local } from "../dist/providers/local.js";
import { memoryProvider } from "../dist/testing/index.js";

test("fails over in priority order and preserves the hop trail", async () => {
  const first = memoryProvider({ name: "browserbase", failures: { content: new BrowserSdkError("RATE_LIMITED", "limit", { provider: "browserbase", retryable: true }) } });
  const second = memoryProvider({ name: "cloudflare-browser-run", content: "<h1>hello</h1>" });
  const events = [];
  const client = createBrowserClient({ providers: [first, second], retries: 0, cache: false, onFailover: (event) => events.push(event) });

  const result = await client.content("https://example.com");

  assert.equal(result.provider, "cloudflare-browser-run");
  assert.equal(result.failedOverFrom?.[0]?.provider, "browserbase");
  assert.equal(result.failedOverFrom?.[0]?.reason, "rate_limit");
  assert.equal(events[0].from, "browserbase");
  assert.equal(events[0].to, "cloudflare-browser-run");
});

test("retries a retryable provider failure before moving on", async () => {
  let attempts = 0;
  const provider = memoryProvider({
    name: "browserbase",
    content: "<h1>ok</h1>",
    failures: { content: () => (++attempts === 1 ? new BrowserSdkError("PROVIDER_UNAVAILABLE", "busy", { retryable: true }) : new Error("unreachable")) },
  });
  // The memory provider's failure hook is intentionally static; a custom provider
  // keeps this test focused on the client's retry contract.
  const retrying = {
    ...provider,
    async content(source, options, context) {
      attempts += 1;
      if (attempts === 1) throw new BrowserSdkError("PROVIDER_UNAVAILABLE", "busy", { provider: "browserbase", retryable: true });
      return { source, provider: "browserbase", latencyMs: 1, content: "<h1>recovered</h1>" };
    },
  };
  const client = createBrowserClient({ providers: [retrying], retries: 1, cache: false });
  const result = await client.content("https://example.com");
  assert.equal(result.content, "<h1>recovered</h1>");
  assert.equal(attempts, 2);
});

test("retries and fails over on raw network errors", async () => {
  const firstBase = memoryProvider({ name: "browserbase" });
  const first = {
    ...firstBase,
    async content() {
      throw new TypeError("fetch failed");
    },
  };
  const second = memoryProvider({ name: "cloudflare-browser-run", content: "<h1>recovered</h1>" });
  const client = createBrowserClient({ providers: [first, second], retries: 0, cache: false });
  const result = await client.content("https://example.com");
  assert.equal(result.provider, "cloudflare-browser-run");
  assert.equal(result.failedOverFrom?.[0]?.reason, "provider_unavailable");
});

test("withSession always closes the session", async () => {
  const memory = memoryProvider({ name: "local" });
  const client = createBrowserClient({ providers: [memory], retries: 0 });
  const seen = await client.withSession(undefined, async (session) => {
    assert.equal(session.provider, "local");
    return session.id;
  });
  assert.match(seen, /^memory_/);
  assert.equal(memory.calls.filter((call) => call.operation === "closeSession").length, 1);
});

test("missing capabilities fail with a typed error", async () => {
  const client = createBrowserClient({ providers: [memoryProvider({ capabilities: ["content"] })], retries: 0 });
  await assert.rejects(() => client.screenshot("https://example.com"), (error) => {
    assert.equal(error.code, "UNSUPPORTED_OPERATION");
    assert.equal(error.name, "CapabilityError");
    return true;
  });
});

test("all provider failure retains typed provider errors", async () => {
  const first = memoryProvider({ name: "browserbase", failures: { content: new BrowserSdkError("AUTHENTICATION_FAILED", "bad key", { provider: "browserbase" }) } });
  const second = memoryProvider({ name: "cloudflare-browser-run", failures: { content: new BrowserSdkError("PROVIDER_UNAVAILABLE", "down", { provider: "cloudflare-browser-run", retryable: true }) } });
  const client = createBrowserClient({ providers: [first, second], retries: 0, cache: false });
  await assert.rejects(() => client.content("https://example.com"), (error) => {
    assert.ok(error instanceof AllProvidersFailedError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].code, "AUTHENTICATION_FAILED");
    return true;
  });
});

test("local HTML fallback returns Markdown and honors maxChars", async () => {
  const client = createBrowserClient({ providers: [local()], cache: false, retries: 0 });
  const result = await client.markdown({ html: "<html><title>Fixture</title><body><h1>Hello</h1><p>World</p></body></html>" }, { maxChars: 7 });
  assert.equal(result.provider, "local");
  assert.equal(result.markdown, "# Hello");
  assert.equal(result.truncated, true);
  assert.equal(result.charCount > result.markdown.length, true);
});

test("error redaction removes credentials from nested payloads", () => {
  const safe = redact({ authorization: "Bearer super-secret", nested: { apiKey: "key-secret", visible: "ok" } });
  assert.deepEqual(safe, { authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", visible: "ok" } });
  assert.equal(redact("https://example.com/?token=query-secret&keep=ok"), "https://example.com/?token=[REDACTED]&keep=ok");
});

test("fromEnv keeps the default runway stable and opts into extended providers", () => {
  const keys = [
    "BROWSERBASE_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "BROWSERLESS_API_KEY",
    "STEEL_API_KEY",
    "ANCHOR_API_KEY",
    "HYPERBROWSER_API_KEY",
    "BROWSER_USE_API_KEY",
    "BROWSER_SDK_EXTENDED_PROVIDERS",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.BROWSERBASE_API_KEY = "bb_test";
    process.env.ANCHOR_API_KEY = "anchor_test";
    process.env.HYPERBROWSER_API_KEY = "hyper_test";
    process.env.BROWSER_USE_API_KEY = "bu_test";
    const defaultNames = fromEnv({ cache: false }).providers().map((provider) => provider.name);
    const extendedNames = fromEnv({ cache: false, includeExtendedProviders: true }).providers().map((provider) => provider.name);
    assert.deepEqual(defaultNames, ["browserbase", "local"]);
    assert.deepEqual(extendedNames, ["browserbase", "anchor", "hyperbrowser", "browser-use", "local"]);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
