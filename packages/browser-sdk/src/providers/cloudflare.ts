import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestBytes, requestJson, sleep } from "../http.js";
import { firstHeading, sourceRecord } from "../utils.js";
import { assertSupportedSessionOptions } from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  CrawlOptions,
  CrawlRecord,
  CrawlResult,
  ExtractResult,
  LinksResult,
  MarkdownResult,
  PdfResult,
  ProviderContext,
  RenderOptions,
  ScreenshotFormat,
  ScreenshotResult,
  SessionOptions,
  SnapshotResult,
} from "../types.js";

export interface CloudflareConfig {
  apiToken: string;
  accountId: string;
  baseUrl?: string;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: unknown;
  messages?: unknown;
}

interface CloudflareBrowserResponse {
  sessionId?: unknown;
  webSocketDebuggerUrl?: unknown;
}

interface CloudflareDevtoolsSession {
  sessionId?: unknown;
  closeReason?: unknown;
  closeReasonText?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  lastUpdated?: unknown;
  webSocketDebuggerUrl?: unknown;
}

const PROVIDER = "cloudflare-browser-run";

export function cloudflare(config: CloudflareConfig): BrowserProvider {
  if (!config.apiToken?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "cloudflare requires apiToken.", { provider: PROVIDER });
  if (!config.accountId?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "cloudflare requires accountId.", { provider: PROVIDER });
  const baseUrl = `${(config.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "")}/accounts/${encodeURIComponent(config.accountId)}/browser-rendering`;
  const auth = { Authorization: `Bearer ${config.apiToken}` };

  return {
    name: PROVIDER,
    capabilities: ["session", "content", "markdown", "screenshot", "pdf", "snapshot", "accessibility", "extract", "links", "crawl"],
    cost: 4,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertSupportedSessionOptions(options, PROVIDER, ["keepAliveMs", "recording", "allowedDomains"]);
      if (options.keepAliveMs !== undefined && (options.keepAliveMs < 10_000 || options.keepAliveMs > 1_200_000)) {
        throw new BrowserSdkError("INVALID_OPTION", "Cloudflare keepAliveMs must be between 10000ms and 1200000ms.", { provider: PROVIDER });
      }
      const endpoint = new URL(`${baseUrl}/devtools/browser`);
      if (options.keepAliveMs !== undefined) endpoint.searchParams.set("keep_alive", String(Math.round(options.keepAliveMs)));
      if (options.recording !== undefined) endpoint.searchParams.set("recording", String(options.recording));
      const providerOptions = options.providerOptions ?? {};
      for (const key of ["lab", "targets", "liveViewUrlExpiresInMs"] as const) {
        const value = providerOptions[key];
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      const guardrails = isRecord(providerOptions.guardrails) ? providerOptions.guardrails : {};
      const allowedDomains = options.allowedDomains ? [...options.allowedDomains] : undefined;
      if (allowedDomains && allowedDomains.length > 50) {
        throw new BrowserSdkError("INVALID_OPTION", "Cloudflare allowedDomains cannot contain more than 50 host patterns.", { provider: PROVIDER });
      }
      const body = {
        ...providerOptions,
        ...(allowedDomains || Object.keys(guardrails).length ? {
          guardrails: {
            ...guardrails,
            ...(allowedDomains ? { allowedDomains } : {}),
          },
        } : {}),
      };
      const response = await requestJson<CloudflareBrowserResponse>(context, endpoint.href, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const id = stringValue(response.sessionId);
      if (!id) throw new ProviderResponseError(PROVIDER, "Cloudflare returned no browser session id.");
      const connectUrl = stringValue(response.webSocketDebuggerUrl) ?? `${endpoint.origin}${endpoint.pathname}/${encodeURIComponent(id)}${endpoint.search}`.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
      return {
        id,
        provider: PROVIDER,
        status: "ready",
        connectUrl,
      };
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<CloudflareDevtoolsSession>(context, `${baseUrl}/devtools/session/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapDevtoolsSession(response, id);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const url = new URL(`${baseUrl}/devtools/session`);
      url.searchParams.set("limit", String(options.limit ?? 50));
      url.searchParams.set("offset", "0");
      const response = await requestJson<CloudflareDevtoolsSession[]>(context, url.href, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      const sessions = response.map((session) => mapDevtoolsSession(session));
      return options.status ? sessions.filter((session) => statusMatches(session.status, options.status!)) : sessions;
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await request(context, `${baseUrl}/devtools/browser/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
    },
    async content(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult> {
      const startedAt = Date.now();
      const content = await quickJson<unknown>(source, options, context, `${baseUrl}/content`, auth);
      if (typeof content !== "string") throw new ProviderResponseError(PROVIDER, "Cloudflare returned a non-string content result.");
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        content,
        ...(firstHeading(content) ? { title: firstHeading(content) } : {}),
      };
    },
    async markdown(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<MarkdownResult> {
      const startedAt = Date.now();
      const markdown = await quickJson<unknown>(source, options, context, `${baseUrl}/markdown`, auth);
      if (typeof markdown !== "string") throw new ProviderResponseError(PROVIDER, "Cloudflare returned a non-string Markdown result.");
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        markdown,
        ...(firstHeading(markdown) ? { title: firstHeading(markdown) } : {}),
      };
    },
    async screenshot(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }, context: ProviderContext): Promise<ScreenshotResult> {
      const startedAt = Date.now();
      const body = renderBody(source, options);
      body.screenshotOptions = {
        ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
        ...(options.selector ? { selector: options.selector } : {}),
        ...(options.quality === undefined ? {} : { quality: options.quality }),
        type: options.format ?? "png",
      };
      const binary = await requestBytes(context, `${baseUrl}/screenshot`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: binary.data,
        contentType: binary.contentType,
        format: normalizeScreenshotFormat(options.format, binary.contentType),
        usage: usageFromHeaders(binary.headers),
      };
    },
    async pdf(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean }, context: ProviderContext): Promise<PdfResult> {
      const startedAt = Date.now();
      const body = renderBody(source, options);
      body.pdfOptions = {
        ...(options.landscape === undefined ? {} : { landscape: options.landscape }),
        ...(options.printBackground === undefined ? {} : { printBackground: options.printBackground }),
      };
      const binary = await requestBytes(context, `${baseUrl}/pdf`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: binary.data,
        contentType: "application/pdf",
        usage: usageFromHeaders(binary.headers),
      };
    },
    async snapshot(source: BrowserSource, options: RenderOptions & { formats?: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] }, context: ProviderContext): Promise<SnapshotResult> {
      const startedAt = Date.now();
      const body = renderBody(source, options);
      if (options.formats) {
        validateSnapshotFormats(options.formats);
        body.formats = options.formats;
      }
      const response = await requestJson<CloudflareEnvelope<Record<string, unknown>>>(context, `${baseUrl}/snapshot`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const result = envelopeResult(response, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        ...(typeof result.content === "string" ? { content: result.content } : {}),
        ...(typeof result.markdown === "string" ? { markdown: result.markdown } : {}),
        ...(typeof result.accessibilityTree === "undefined" ? {} : { accessibilityTree: result.accessibilityTree }),
        ...(typeof result.screenshot === "string" ? { screenshot: base64ToBytes(result.screenshot) } : {}),
      };
    },
    async accessibility(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<SnapshotResult> {
      const startedAt = Date.now();
      const response = await quickJson<unknown>(source, options, context, `${baseUrl}/accessibilityTree`, auth);
      const accessibilityTree = isRecord(response) && "accessibilityTree" in response ? response.accessibilityTree : response;
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        accessibilityTree,
      };
    },
    async extract<T = unknown>(source: BrowserSource, options: RenderOptions & { prompt?: string; schema?: Record<string, unknown> }, context: ProviderContext): Promise<ExtractResult<T>> {
      const startedAt = Date.now();
      if (!options.prompt?.trim() && !options.schema) throw new BrowserSdkError("INVALID_OPTION", "Cloudflare JSON extraction requires prompt or schema.", { provider: PROVIDER });
      const body = renderBody(source, options);
      if (options.prompt) body.prompt = options.prompt;
      if (options.schema) body.response_format = { type: "json_schema", json_schema: options.schema };
      const response = await requestJson<CloudflareEnvelope<unknown>>(context, `${baseUrl}/json`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: envelopeResult(response, PROVIDER) as T,
        ...(options.prompt ? { prompt: options.prompt } : {}),
      };
    },
    async links(source: BrowserSource, options: RenderOptions & { visibleOnly?: boolean; excludeExternal?: boolean }, context: ProviderContext): Promise<LinksResult> {
      const startedAt = Date.now();
      const body = renderBody(source, options);
      if (options.visibleOnly !== undefined) body.visibleLinksOnly = options.visibleOnly;
      if (options.excludeExternal !== undefined) body.excludeExternalLinks = options.excludeExternal;
      const response = await requestJson<CloudflareEnvelope<unknown>>(context, `${baseUrl}/links`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const result = envelopeResult(response, PROVIDER);
      if (!Array.isArray(result)) throw new ProviderResponseError(PROVIDER, "Cloudflare returned an invalid links result.");
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        links: result.filter((value): value is string => typeof value === "string"),
      };
    },
    async crawl(source: BrowserSource, options: CrawlOptions, context: ProviderContext): Promise<CrawlResult> {
      const startedAt = Date.now();
      const body = renderBody(source, options);
      if (options.limit !== undefined) body.limit = options.limit;
      if (options.depth !== undefined) body.depth = options.depth;
      if (options.formats) body.formats = options.formats;
      if (options.includePatterns || options.excludePatterns) {
        body.options = {
          ...(isRecord(body.options) ? body.options : {}),
          ...(options.includePatterns ? { includePatterns: options.includePatterns } : {}),
          ...(options.excludePatterns ? { excludePatterns: options.excludePatterns } : {}),
        };
      }
      if (options.crawlPurposes) body.crawlPurposes = options.crawlPurposes;
      if (options.userAgent) throw new UnsupportedOptionError("userAgent", PROVIDER);
      const started = await requestJson<CloudflareEnvelope<string>>(context, `${baseUrl}/crawl`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const jobId = envelopeResult(started, PROVIDER);
      if (!jobId) throw new ProviderResponseError(PROVIDER, "Cloudflare returned no crawl job id.");
      const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 1_000);
      let result: Record<string, unknown> | undefined;
      let terminal = false;
      try {
        while (true) {
          await sleep(pollIntervalMs, context.signal);
          const statusUrl = new URL(`${baseUrl}/crawl/${encodeURIComponent(jobId)}`);
          statusUrl.searchParams.set("limit", "1");
          const response = await requestJson<CloudflareEnvelope<Record<string, unknown>>>(context, statusUrl.href, {
            method: "GET",
            headers: { Accept: "application/json", ...auth },
          }, PROVIDER);
          result = envelopeResult(response, PROVIDER);
          const status = typeof result.status === "string" ? result.status : undefined;
          if (!status) throw new ProviderResponseError(PROVIDER, "Cloudflare returned a crawl result without a status.");
          if (status !== "running" && status !== "queued") {
            terminal = true;
            break;
          }
        }
        const finalResponse = await requestJson<CloudflareEnvelope<Record<string, unknown>>>(context, `${baseUrl}/crawl/${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: { Accept: "application/json", ...auth },
        }, PROVIDER);
        result = envelopeResult(finalResponse, PROVIDER);
      } finally {
        if (!terminal) {
          await request({ ...context, signal: undefined }, `${baseUrl}/crawl/${encodeURIComponent(jobId)}`, {
            method: "DELETE",
            headers: { Accept: "application/json", ...auth },
          }, PROVIDER).catch((error) => {
            context.logger.warn?.("Cloudflare crawl cleanup failed.", { jobId, error: String(error) });
          });
        }
      }
      if (!result) throw new ProviderResponseError(PROVIDER, "Cloudflare returned no crawl result.");
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        jobId,
        status: result.status === "completed" ? "completed" : "failed",
        records: Array.isArray(result.records) ? result.records.map(mapCrawlRecord) : [],
        ...(typeof result.total === "number" ? { total: result.total } : {}),
        ...(typeof result.finished === "number" ? { finished: result.finished } : {}),
        ...(typeof result.cursor === "number" ? { cursor: result.cursor } : {}),
      };
    },
  };
}

async function quickJson<T>(source: BrowserSource, options: RenderOptions, context: ProviderContext, endpoint: string, auth: Record<string, string>): Promise<T> {
  const response = await requestJson<CloudflareEnvelope<T>>(context, endpoint, {
    ...jsonInit(renderBody(source, options), auth),
  }, PROVIDER);
  return envelopeResult(response, PROVIDER);
}

function renderBody(source: BrowserSource, options: RenderOptions): Record<string, unknown> {
  if (options.proxy) throw new UnsupportedOptionError("proxy", PROVIDER);
  const body: Record<string, unknown> = {
    ...sourceRecord(source),
    ...(options.cookies ? { cookies: options.cookies } : {}),
    ...(options.headers ? { setExtraHTTPHeaders: options.headers } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(options.gotoOptions ? { gotoOptions: options.gotoOptions } : {}),
    ...(options.waitForSelector ? { waitForSelector: { selector: options.waitForSelector } } : {}),
    ...(options.waitForTimeout === undefined ? {} : { waitForTimeout: options.waitForTimeout }),
    ...(options.addScriptTag ? { addScriptTag: options.addScriptTag } : {}),
    ...(options.addStyleTag ? { addStyleTag: options.addStyleTag } : {}),
    ...(options.setExtraHTTPHeaders ? { setExtraHTTPHeaders: options.setExtraHTTPHeaders } : {}),
    ...(options.authenticate ? { authenticate: options.authenticate } : {}),
    ...options.providerOptions,
  };
  return body;
}

function envelopeResult<T>(response: CloudflareEnvelope<T>, provider: string): T {
  if (response.success === false || response.result === undefined) {
    throw new ProviderResponseError(provider, "Cloudflare returned an unsuccessful response.", { errors: response.errors });
  }
  return response.result;
}

function usageFromHeaders(headers: Headers): { browserMsUsed?: number } | undefined {
  const value = Number(headers.get("X-Browser-Ms-Used"));
  return Number.isFinite(value) && value >= 0 ? { browserMsUsed: value } : undefined;
}

function normalizeScreenshotFormat(value: ScreenshotFormat | undefined, contentType: string): ScreenshotFormat {
  if (value) return value;
  if (contentType.includes("jpeg")) return "jpeg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function mapDevtoolsSession(value: unknown, fallbackId?: string): BrowserSessionInfo {
  if (!isRecord(value)) throw new ProviderResponseError(PROVIDER, "Cloudflare returned an invalid DevTools session record.");
  const record = value as CloudflareDevtoolsSession;
  const id = stringValue(record.sessionId) ?? fallbackId;
  if (!id) throw new ProviderResponseError(PROVIDER, "Cloudflare returned a session record without an id.");
  const closeReason = `${record.closeReason === undefined || record.closeReason === null || record.closeReason === 0 ? "" : String(record.closeReason)} ${String(record.closeReasonText ?? "")}`.toLowerCase();
  const closed = record.endTime !== undefined || Boolean(closeReason.trim());
  return {
    id,
    provider: PROVIDER,
    status: closeReason.includes("error") || closeReason.includes("fail") ? "failed" : closed ? "closed" : "running",
    ...(stringValue(record.webSocketDebuggerUrl) ? { connectUrl: stringValue(record.webSocketDebuggerUrl) } : {}),
    ...(dateValue(record.startTime) ? { startedAt: dateValue(record.startTime) } : {}),
    ...(dateValue(record.endTime) ? { endedAt: dateValue(record.endTime) } : {}),
  };
}

function statusMatches(status: BrowserSessionInfo["status"], requested: string): boolean {
  const value = requested.toLowerCase().replace(/-/g, "_");
  if (["active", "running", "ready", "pending"].includes(value)) return status === "running" || status === "pending";
  if (["closed", "stopped", "completed", "timed_out", "failed"].includes(value)) return status === value || (value === "stopped" && status === "closed");
  return false;
}

function validateSnapshotFormats(formats: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[]): void {
  if (formats.length < 2) {
    throw new BrowserSdkError("INVALID_OPTION", "Cloudflare snapshot requires at least two formats.", { provider: PROVIDER });
  }
  if (new Set(formats).size !== formats.length) {
    throw new BrowserSdkError("INVALID_OPTION", "Cloudflare snapshot formats must be unique.", { provider: PROVIDER });
  }
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function dateValue(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const timestamp = value < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mapCrawlRecord(value: unknown): CrawlRecord {
  if (!value || typeof value !== "object") return { url: "", status: "unknown" };
  const record = value as Record<string, unknown>;
  return {
    url: typeof record.url === "string" ? record.url : "",
    status: typeof record.status === "string" ? record.status : "unknown",
    ...(typeof record.markdown === "string" ? { markdown: record.markdown } : {}),
    ...(typeof record.html === "string" ? { html: record.html } : {}),
    ...(record.metadata && typeof record.metadata === "object" ? { metadata: record.metadata as Record<string, unknown> } : {}),
  };
}
