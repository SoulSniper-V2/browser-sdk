import { fromEnv } from "@soulsniper-v2/browser-sdk";

const browser = fromEnv();
const page = await browser.markdown("https://example.com", { maxChars: 20_000 });

console.log({
  provider: page.provider,
  latencyMs: page.latencyMs,
  failedOverFrom: page.failedOverFrom,
  markdown: page.markdown,
});
