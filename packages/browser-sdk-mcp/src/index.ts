#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fromEnv } from "@soulsniper-v2/browser-sdk";
import { BrowserRuntime } from "./runtime.js";

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolResult = { content: ToolContent[] };

type ToolRegistrar = (
  name: string,
  description: string,
  shape: Record<string, unknown>,
  callback: (input: Record<string, unknown>) => Promise<ToolResult>,
) => unknown;

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function image(data: Uint8Array, mimeType: string): ToolResult {
  return { content: [{ type: "image", data: Buffer.from(data).toString("base64"), mimeType }] };
}

async function main(): Promise<void> {
  const client = fromEnv({ cache: { ttlMs: 60_000, maxEntries: 100 } });
  const runtime = new BrowserRuntime(client, {
    maxSessions: parsePositiveInteger(process.env.BROWSER_SDK_MAX_SESSIONS, 4),
    allowedDomains: parseDomains(process.env.BROWSER_SDK_ALLOWED_DOMAINS),
  });
  const server = new McpServer(
    { name: "browser-sdk", version: "0.1.1" },
    {
      instructions: "Use https://browser-sdk.dev/llms.txt for the current product index and https://browser-sdk.dev/llms-full.txt when exact behavior is needed. Read-only browser tools can fail over across the configured provider runway. For agent-controlled browsing, start one browser_session_start, snapshot before acting, use one explicit browser_session_action at a time, snapshot again after navigation or actions, and always browser_session_close. Stateful actions are never replayed automatically.",
    },
  );
  // Runtime validation comes from the supplied Zod shapes. This shallow cast
  // keeps the MCP package typecheckable across MCP SDK/Zod minor versions.
  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    "browser_markdown",
    "Read the full rendered body of a web page as Markdown. Use this before taking an action when you need page context.",
    {
      url: z.string().url().describe("Absolute http(s) URL"),
      maxChars: z.number().int().min(500).max(100_000).optional(),
      waitForSelector: z.string().optional(),
    },
    async (input) => {
      const result = await client.markdown(input.url as string, {
        ...(typeof input.maxChars === "number" ? { maxChars: input.maxChars } : {}),
        ...(typeof input.waitForSelector === "string" ? { waitForSelector: input.waitForSelector } : {}),
      });
      return text({
        url: result.source,
        provider: result.provider,
        latencyMs: result.latencyMs,
        truncated: result.truncated ?? false,
        charCount: result.charCount,
        failedOverFrom: result.failedOverFrom,
        content: result.markdown,
      });
    },
  );

  registerTool(
    "browser_extract",
    "Extract structured data from a rendered page using a prompt or JSON Schema.",
    {
      url: z.string().url(),
      prompt: z.string().min(1).max(4_000).optional(),
      schema: z.record(z.string(), z.unknown()).optional(),
    },
    async (input) => {
      const result = await client.extract(input.url as string, {
        ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
        ...(input.schema && typeof input.schema === "object" ? { schema: input.schema as Record<string, unknown> } : {}),
      });
      return text(result);
    },
  );

  registerTool(
    "browser_links",
    "List links discovered on a rendered web page.",
    {
      url: z.string().url(),
      visibleOnly: z.boolean().optional(),
      excludeExternal: z.boolean().optional(),
    },
    async (input) => text(await client.links(input.url as string, {
      ...(typeof input.visibleOnly === "boolean" ? { visibleOnly: input.visibleOnly } : {}),
      ...(typeof input.excludeExternal === "boolean" ? { excludeExternal: input.excludeExternal } : {}),
    })),
  );

  registerTool(
    "browser_route",
    "Explain which configured providers can perform an operation and the order they will be tried.",
    {
      operation: z.enum(["content", "markdown", "screenshot", "pdf", "snapshot", "accessibility", "extract", "links", "crawl", "session"]),
    },
    async (input) => text(client.routePreview(input.operation as Parameters<typeof client.routePreview>[0])),
  );

  registerTool(
    "browser_snapshot",
    "Capture multiple representations of a page in one provider call when supported.",
    {
      url: z.string().url(),
      formats: z.array(z.enum(["content", "markdown", "screenshot", "accessibilityTree"])).min(1).optional(),
    },
    async (input) => {
      const result = await client.snapshot(input.url as string, {
        ...(Array.isArray(input.formats) ? { formats: input.formats as ("content" | "markdown" | "screenshot" | "accessibilityTree")[] } : {}),
      });
      return text({ ...result, screenshot: result.screenshot ? `[${result.screenshot.byteLength} bytes]` : undefined });
    },
  );

  if (client.supports("crawl")) {
    registerTool(
      "browser_crawl",
      "Crawl a site with a bounded page limit and return one record per page.",
      {
        url: z.string().url(),
        limit: z.number().int().min(1).max(100).optional(),
        depth: z.number().int().min(0).max(10).optional(),
      },
      async (input) => text(await client.crawl(input.url as string, {
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(typeof input.depth === "number" ? { depth: input.depth } : {}),
      })),
    );
  }

  registerTool(
    "browser_session_start",
    "Start one stateful browser session through the configured provider runway. Returns an opaque session id, never a CDP URL or provider credential. Use browser_session_navigate, browser_session_snapshot, and browser_session_action with this id, then close it explicitly.",
    {
      url: z.string().url().optional().describe("Optional absolute http(s) URL to open after the session starts"),
      profileId: z.string().min(1).optional(),
      region: z.string().min(1).optional(),
      timeoutMs: z.number().int().min(60_000).max(21_600_000).optional(),
      keepAlive: z.boolean().optional(),
      keepAliveMs: z.number().int().min(1_000).max(600_000).optional(),
      proxy: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
      viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
      userAgent: z.string().min(1).optional(),
      recording: z.boolean().optional(),
      logSession: z.boolean().optional(),
      stealth: z.boolean().optional(),
      solveCaptchas: z.boolean().optional(),
      allowedDomains: z.array(z.string().min(1)).max(50).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (input) => text(await runtime.start({
      ...(typeof input.url === "string" ? { url: input.url } : {}),
      ...(typeof input.profileId === "string" ? { profileId: input.profileId } : {}),
      ...(typeof input.region === "string" ? { region: input.region } : {}),
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
      ...(typeof input.keepAlive === "boolean" ? { keepAlive: input.keepAlive } : {}),
      ...(typeof input.keepAliveMs === "number" ? { keepAliveMs: input.keepAliveMs } : {}),
      ...(typeof input.proxy === "boolean" || (input.proxy && typeof input.proxy === "object") ? { proxy: input.proxy as boolean | Record<string, unknown> } : {}),
      ...(input.viewport && typeof input.viewport === "object" ? { viewport: input.viewport as { width: number; height: number } } : {}),
      ...(typeof input.userAgent === "string" ? { userAgent: input.userAgent } : {}),
      ...(typeof input.recording === "boolean" ? { recording: input.recording } : {}),
      ...(typeof input.logSession === "boolean" ? { logSession: input.logSession } : {}),
      ...(typeof input.stealth === "boolean" ? { stealth: input.stealth } : {}),
      ...(typeof input.solveCaptchas === "boolean" ? { solveCaptchas: input.solveCaptchas } : {}),
      ...(Array.isArray(input.allowedDomains) ? { allowedDomains: input.allowedDomains.filter((domain): domain is string => typeof domain === "string") } : {}),
      ...(input.metadata && typeof input.metadata === "object" ? { metadata: input.metadata as Record<string, unknown> } : {}),
    })),
  );

  registerTool(
    "browser_session_list",
    "List active stateful MCP browser sessions without exposing connection URLs or credentials.",
    {},
    async () => text(await runtime.list()),
  );

  registerTool(
    "browser_session_navigate",
    "Navigate an existing MCP browser session. This mutates that session only and is never automatically replayed or failed over.",
    {
      sessionId: z.string().min(1),
      url: z.string().url(),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
      timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
    },
    async (input) => text(await runtime.navigate(input.sessionId as string, input.url as string, {
      ...(typeof input.waitUntil === "string" ? { waitUntil: input.waitUntil as "load" | "domcontentloaded" | "networkidle" } : {}),
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
    })),
  );

  registerTool(
    "browser_session_snapshot",
    "Capture the current page as an accessibility-oriented snapshot with short-lived e1/e2 element refs. Re-snapshot after navigation or any action before acting again.",
    {
      sessionId: z.string().min(1),
      maxChars: z.number().int().min(500).max(100_000).optional(),
    },
    async (input) => text(await runtime.snapshot(input.sessionId as string, typeof input.maxChars === "number" ? input.maxChars : 20_000)),
  );

  registerTool(
    "browser_session_read",
    "Read visible text from the current page or one element in an MCP browser session. Prefer browser_session_snapshot when you need action refs.",
    {
      sessionId: z.string().min(1),
      ref: z.string().regex(/^e\d+$/).optional(),
      selector: z.string().min(1).optional(),
      maxChars: z.number().int().min(1).max(100_000).optional(),
    },
    async (input) => text(await runtime.read(input.sessionId as string, {
      ...(typeof input.ref === "string" ? { ref: input.ref } : {}),
      ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
      ...(typeof input.maxChars === "number" ? { maxChars: input.maxChars } : {}),
    })),
  );

  registerTool(
    "browser_session_action",
    "Perform one explicit browser action in an existing session. Actions can click, fill, type, press, select, check, uncheck, hover, wait, or scroll. This is the side-effect boundary: the MCP server never retries or replays it.",
    {
      sessionId: z.string().min(1),
      action: z.enum(["click", "fill", "type", "press", "select", "check", "uncheck", "hover", "wait", "scroll"]),
      ref: z.string().regex(/^e\d+$/).optional(),
      selector: z.string().min(1).optional(),
      role: z.string().min(1).optional(),
      name: z.string().optional(),
      value: z.string().optional(),
      key: z.string().optional(),
      milliseconds: z.number().int().min(0).max(10_000).optional(),
      pixels: z.number().int().min(-20_000).max(20_000).optional(),
      timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
    },
    async (input) => text(await runtime.action(input.sessionId as string, {
      action: input.action as "click" | "fill" | "type" | "press" | "select" | "check" | "uncheck" | "hover" | "wait" | "scroll",
      ...(typeof input.ref === "string" ? { ref: input.ref } : {}),
      ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
      ...(typeof input.role === "string" ? { role: input.role } : {}),
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(typeof input.value === "string" ? { value: input.value } : {}),
      ...(typeof input.key === "string" ? { key: input.key } : {}),
      ...(typeof input.milliseconds === "number" ? { milliseconds: input.milliseconds } : {}),
      ...(typeof input.pixels === "number" ? { pixels: input.pixels } : {}),
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
    })),
  );

  registerTool(
    "browser_session_screenshot",
    "Capture a screenshot from an existing MCP browser session. Returns image content directly; use browser_session_snapshot for element selection and action refs.",
    {
      sessionId: z.string().min(1),
      ref: z.string().regex(/^e\d+$/).optional(),
      selector: z.string().min(1).optional(),
      fullPage: z.boolean().optional(),
      format: z.enum(["png", "jpeg"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    },
    async (input) => {
      const result = await runtime.screenshot(input.sessionId as string, {
        ...(typeof input.ref === "string" ? { ref: input.ref } : {}),
        ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
        ...(typeof input.fullPage === "boolean" ? { fullPage: input.fullPage } : {}),
        ...(input.format === "png" || input.format === "jpeg" ? { format: input.format } : {}),
        ...(typeof input.quality === "number" ? { quality: input.quality } : {}),
      });
      return image(result.data, result.mimeType);
    },
  );

  registerTool(
    "browser_session_close",
    "Close an MCP browser session and release its provider resources. Call this when the workflow is finished.",
    { sessionId: z.string().min(1) },
    async (input) => text(await runtime.close(input.sessionId as string)),
  );

  const shutdown = async () => {
    await runtime.closeAll();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await server.connect(new StdioServerTransport());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDomains(value: string | undefined): readonly string[] | undefined {
  const domains = value?.split(",").map((domain) => domain.trim()).filter(Boolean);
  return domains?.length ? domains : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
