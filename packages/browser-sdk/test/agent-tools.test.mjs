import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserClient } from "../dist/index.js";
import { createBrowserTools } from "../dist/agent-tools.js";
import { memoryProvider } from "../dist/testing/index.js";

test("agent tools expose the read-only browser surface without a model dependency", async () => {
  const client = createBrowserClient({
    providers: [memoryProvider({ capabilities: ["content", "markdown"] })],
    cache: false,
    retries: 0,
  });
  const tools = createBrowserTools(client);
  assert.deepEqual(Object.keys(tools).sort(), ["browser_content", "browser_extract", "browser_links", "browser_markdown", "browser_providers", "browser_route"]);
  assert.deepEqual(tools.browser_extract.inputSchema.anyOf, [{ required: ["prompt"] }, { required: ["schema"] }]);
  const result = await tools.browser_markdown.execute({ url: "https://example.com", maxChars: 500 });
  assert.equal(result.provider, "memory");
  assert.equal(typeof result.markdown, "string");
  assert.equal(tools.browser_providers.execute instanceof Function, true);
});
