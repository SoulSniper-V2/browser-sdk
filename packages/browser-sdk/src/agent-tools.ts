import type { BrowserClient, BrowserSource } from "./types.js";

export interface BrowserToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Framework-neutral tool definitions for Vercel AI SDK, OpenAI Agents, or a
 * custom tool loop. The schemas are plain JSON Schema so this module has no
 * model-provider dependency.
 */
export function createBrowserTools(client: BrowserClient): Record<string, BrowserToolDefinition> {
  const tools: Record<string, BrowserToolDefinition> = {
    browser_markdown: {
      description: "Read a rendered web page as Markdown. Use this for research and page context before taking actions.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          maxChars: { type: "integer", minimum: 500, maximum: 100_000 },
          waitForSelector: { type: "string" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      async execute(input) {
        const result = await client.markdown(input.url as BrowserSource, {
          ...(typeof input.maxChars === "number" ? { maxChars: input.maxChars } : {}),
          ...(typeof input.waitForSelector === "string" ? { waitForSelector: input.waitForSelector } : {}),
        });
        return { url: result.source, markdown: result.markdown, provider: result.provider, latencyMs: result.latencyMs, failedOverFrom: result.failedOverFrom };
      },
    },
    browser_content: {
      description: "Read rendered HTML from a web page. Prefer browser_markdown when the result is going into model context.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          maxChars: { type: "integer", minimum: 500, maximum: 100_000 },
          waitForSelector: { type: "string" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      async execute(input) {
        const result = await client.content(input.url as BrowserSource, {
          ...(typeof input.maxChars === "number" ? { maxChars: input.maxChars } : {}),
          ...(typeof input.waitForSelector === "string" ? { waitForSelector: input.waitForSelector } : {}),
        });
        return { url: result.source, content: result.content, title: result.title, provider: result.provider, latencyMs: result.latencyMs, failedOverFrom: result.failedOverFrom };
      },
    },
    browser_extract: {
      description: "Extract structured data from a rendered web page using a JSON Schema.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", format: "uri" }, prompt: { type: "string" }, schema: { type: "object" } },
        required: ["url"],
        anyOf: [{ required: ["prompt"] }, { required: ["schema"] }],
        additionalProperties: false,
      },
      async execute(input) {
        const result = await client.extract(input.url as BrowserSource, {
          ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
          ...(input.schema && typeof input.schema === "object" ? { schema: input.schema as Record<string, unknown> } : {}),
        });
        return { url: result.source, data: result.data, provider: result.provider, latencyMs: result.latencyMs, failedOverFrom: result.failedOverFrom };
      },
    },
    browser_links: {
      description: "List links discovered on a rendered page.",
      inputSchema: { type: "object", properties: { url: { type: "string", format: "uri" }, visibleOnly: { type: "boolean" }, excludeExternal: { type: "boolean" } }, required: ["url"], additionalProperties: false },
      async execute(input) {
        const result = await client.links(input.url as BrowserSource, {
          ...(typeof input.visibleOnly === "boolean" ? { visibleOnly: input.visibleOnly } : {}),
          ...(typeof input.excludeExternal === "boolean" ? { excludeExternal: input.excludeExternal } : {}),
        });
        return { url: result.source, links: result.links, provider: result.provider, latencyMs: result.latencyMs };
      },
    },
    browser_route: {
      description: "Inspect which configured browser providers can perform an operation, in route order.",
      inputSchema: { type: "object", properties: { operation: { type: "string", enum: ["content", "markdown", "screenshot", "pdf", "snapshot", "accessibility", "extract", "links", "crawl", "session"] } }, required: ["operation"], additionalProperties: false },
      async execute(input) {
        return client.routePreview(input.operation as Parameters<BrowserClient["routePreview"]>[0]);
      },
    },
  };

  tools.browser_providers = {
    description: "List configured browser providers, their declared capabilities, and relative route costs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return client.providers();
    },
  };

  if (client.supports("snapshot")) {
    tools.browser_snapshot = {
      description: "Capture model-ready page representations in one provider call when supported.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          formats: { type: "array", items: { type: "string", enum: ["content", "markdown", "screenshot", "accessibilityTree"] }, minItems: 1 },
        },
        required: ["url"],
        additionalProperties: false,
      },
      async execute(input) {
        const result = await client.snapshot(input.url as BrowserSource, {
          ...(Array.isArray(input.formats) ? { formats: input.formats as ("content" | "markdown" | "screenshot" | "accessibilityTree")[] } : {}),
        });
        return { ...result, screenshot: result.screenshot ? `[${result.screenshot.byteLength} bytes]` : undefined };
      },
    };
  }

  if (client.supports("crawl")) {
    tools.browser_crawl = {
      description: "Crawl a site with a bounded page limit and return one record per page.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", format: "uri" }, limit: { type: "integer", minimum: 1, maximum: 100 }, depth: { type: "integer", minimum: 0, maximum: 10 } },
        required: ["url"],
        additionalProperties: false,
      },
      async execute(input) {
        return client.crawl(input.url as BrowserSource, {
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
          ...(typeof input.depth === "number" ? { depth: input.depth } : {}),
        });
      },
    };
  }

  return tools;
}
