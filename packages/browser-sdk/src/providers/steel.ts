import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestBytes, requestJson } from "../http.js";
import { firstHeading, htmlTitle, htmlToMarkdown, sourceRecord } from "../utils.js";
import { assertViewportWithoutScale } from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  ExtractResult,
  MarkdownResult,
  PdfResult,
  ProviderContext,
  RenderOptions,
  ScreenshotFormat,
  ScreenshotResult,
  SessionOptions,
} from "../types.js";

export interface SteelConfig {
  apiKey: string;
  baseUrl?: string;
  connectUrl?: string;
}

interface SteelSessionResponse {
  id?: unknown;
  status?: unknown;
  debugUrl?: unknown;
  sessionViewerUrl?: unknown;
  websocketUrl?: unknown;
  timeout?: unknown;
  duration?: unknown;
  dimensions?: unknown;
  profileId?: unknown;
  userAgent?: unknown;
  headless?: unknown;
  region?: unknown;
  expiresAt?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
}

interface SteelScrapeResponse {
  content?: { html?: unknown; markdown?: unknown; cleaned_html?: unknown; readability?: unknown };
  metadata?: Record<string, unknown>;
  links?: unknown;
  screenshot?: { url?: unknown };
  pdf?: { url?: unknown };
}

interface SteelArtifactResponse {
  url?: unknown;
}

interface SteelSessionListResponse {
  sessions?: unknown;
}

const PROVIDER = "steel";

export function steel(config: SteelConfig): BrowserProvider {
  if (!config.apiKey?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "steel requires apiKey.", { provider: PROVIDER });
  const baseUrl = (config.baseUrl ?? "https://api.steel.dev").replace(/\/$/, "");
  const connectBase = (config.connectUrl ?? "wss://connect.steel.dev").replace(/\/$/, "");
  const auth = { "steel-api-key": config.apiKey };

  return {
    name: PROVIDER,
    capabilities: ["session", "content", "markdown", "screenshot", "pdf"],
    cost: 5,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertSteelSessionOptions(options);
      assertViewportWithoutScale(options.viewport, PROVIDER);
      const body: Record<string, unknown> = {
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
        ...(options.keepAliveMs ? { inactivityTimeout: options.keepAliveMs } : {}),
        ...(options.proxy ? { useProxy: options.proxy } : {}),
        ...(options.region ? { region: options.region } : {}),
        ...(options.viewport ? { dimensions: { width: options.viewport.width, height: options.viewport.height } } : {}),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        ...(options.headless === undefined ? {} : { headless: options.headless }),
        ...(options.stealth ? { stealthConfig: { humanizeInteractions: true } } : {}),
        ...(options.solveCaptchas === undefined ? {} : { solveCaptcha: options.solveCaptchas }),
        ...(options.profileId ? { profileId: options.profileId } : {}),
        ...options.providerOptions,
      };
      const response = await requestJson<SteelSessionResponse>(context, `${baseUrl}/v1/sessions`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const id = stringValue(response.id);
      if (!id) throw new ProviderResponseError(PROVIDER, "Steel returned no session id.");
      const connectUrl = new URL(connectBase);
      connectUrl.searchParams.set("apiKey", config.apiKey);
      connectUrl.searchParams.set("sessionId", id);
      return {
        id,
        provider: PROVIDER,
        status: normalizeStatus(response.status),
        connectUrl: stringValue(response.websocketUrl) ?? connectUrl.href,
        ...(stringValue(response.debugUrl) ? { debuggerUrl: stringValue(response.debugUrl) } : {}),
        ...(stringValue(response.sessionViewerUrl) ? { dashboardUrl: stringValue(response.sessionViewerUrl) } : {}),
        ...(stringValue(response.region) ? { region: stringValue(response.region) } : {}),
        ...(stringValue(response.expiresAt) ? { expiresAt: stringValue(response.expiresAt) } : {}),
      };
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<SteelSessionResponse>(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapSession(response, connectBase, config.apiKey);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const url = new URL(`${baseUrl}/v1/sessions`);
      if (options.status) url.searchParams.set("status", steelStatus(options.status));
      if (options.limit) url.searchParams.set("limit", String(options.limit));
      const response = await requestJson<SteelSessionListResponse | SteelSessionResponse[]>(context, url.href, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      const sessions = Array.isArray(response) ? response : Array.isArray(response.sessions) ? response.sessions : [];
      return sessions.slice(0, options.limit ?? 50).map((session) => mapSession(session, connectBase, config.apiKey));
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await request(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}/release`, {
        method: "POST",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
    },
    async content(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult> {
      const startedAt = Date.now();
      const response = await scrape(source, options, context, baseUrl, auth, ["html"]);
      const html = stringValue(response.content?.html) ?? stringValue(response.content?.cleaned_html);
      if (!html) throw new ProviderResponseError(PROVIDER, "Steel returned no HTML content.");
      const statusCode = typeof response.metadata?.statusCode === "number"
        ? response.metadata.statusCode
        : typeof response.metadata?.status_code === "number"
          ? response.metadata.status_code
          : undefined;
      const finalUrl = stringValue(response.metadata?.urlSource) ?? stringValue(response.metadata?.url);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        content: html,
        ...(stringValue(response.metadata?.title) || htmlTitle(html) || firstHeading(html) ? { title: stringValue(response.metadata?.title) ?? htmlTitle(html) ?? firstHeading(html) } : {}),
        ...(statusCode === undefined ? {} : { statusCode }),
        ...(finalUrl ? { finalUrl } : {}),
      };
    },
    async markdown(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<MarkdownResult> {
      const startedAt = Date.now();
      const response = await scrape(source, options, context, baseUrl, auth, ["markdown"]);
      const markdown = stringValue(response.content?.markdown);
      if (!markdown) {
        const html = stringValue(response.content?.html) ?? "";
        if (!html) throw new ProviderResponseError(PROVIDER, "Steel returned no Markdown content.");
        return {
          source,
          provider: PROVIDER,
          latencyMs: Date.now() - startedAt,
          markdown: htmlToMarkdown(html),
          ...(stringValue(response.metadata?.title) ? { title: stringValue(response.metadata?.title) } : {}),
        };
      }
      const finalUrl = stringValue(response.metadata?.urlSource) ?? stringValue(response.metadata?.url);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        markdown,
        ...(stringValue(response.metadata?.title) ? { title: stringValue(response.metadata?.title) } : {}),
        ...(finalUrl ? { finalUrl } : {}),
      };
    },
    async screenshot(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }, context: ProviderContext): Promise<ScreenshotResult> {
      assertSteelArtifactOptions(source, options, "screenshot");
      const startedAt = Date.now();
      const response = await requestJson<SteelArtifactResponse>(context, `${baseUrl}/v1/screenshot`, {
        ...jsonInit(artifactBody(source, options, { fullPage: options.fullPage }), auth),
      }, PROVIDER);
      const artifactUrl = stringValue(response.url);
      if (!artifactUrl) throw new ProviderResponseError(PROVIDER, "Steel returned no screenshot URL.");
      const artifact = await requestBytes(context, artifactUrl, { method: "GET" }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: artifact.data,
        contentType: artifact.contentType,
        format: normalizeFormat(options.format, artifact.contentType),
      };
    },
    async pdf(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean }, context: ProviderContext): Promise<PdfResult> {
      assertSteelArtifactOptions(source, options, "pdf");
      const startedAt = Date.now();
      const response = await requestJson<SteelArtifactResponse>(context, `${baseUrl}/v1/pdf`, {
        ...jsonInit(artifactBody(source, options), auth),
      }, PROVIDER);
      const artifactUrl = stringValue(response.url);
      if (!artifactUrl) throw new ProviderResponseError(PROVIDER, "Steel returned no PDF URL.");
      const artifact = await requestBytes(context, artifactUrl, { method: "GET" }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: artifact.data,
        contentType: "application/pdf",
      };
    },
  };
}

async function scrape(
  source: BrowserSource,
  options: RenderOptions,
  context: ProviderContext,
  baseUrl: string,
  auth: Record<string, string>,
  format: readonly string[],
): Promise<SteelScrapeResponse> {
  const sourceInput = sourceRecord(source);
  assertSteelScrapeOptions(source, options);
  const body: Record<string, unknown> = {
    ...sourceInput,
    format,
    ...(options.waitForTimeout === undefined ? {} : { delay: options.waitForTimeout }),
    ...(options.proxy === undefined ? {} : { useProxy: options.proxy }),
    ...options.providerOptions,
  };
  return requestJson<SteelScrapeResponse>(context, `${baseUrl}/v1/scrape`, {
    ...jsonInit(body, auth),
  }, PROVIDER);
}

function mapSession(response: SteelSessionResponse, connectBase: string, apiKey: string): BrowserSessionInfo {
  const id = stringValue(response.id);
  if (!id) throw new ProviderResponseError(PROVIDER, "Steel returned no session id.");
  const connectUrl = new URL(connectBase);
  connectUrl.searchParams.set("apiKey", apiKey);
  connectUrl.searchParams.set("sessionId", id);
  return {
    id,
    provider: PROVIDER,
    status: normalizeStatus(response.status),
    connectUrl: stringValue(response.websocketUrl) ?? connectUrl.href,
    ...(stringValue(response.debugUrl) ? { debuggerUrl: stringValue(response.debugUrl) } : {}),
    ...(stringValue(response.sessionViewerUrl) ? { dashboardUrl: stringValue(response.sessionViewerUrl) } : {}),
    ...(stringValue(response.region) ? { region: stringValue(response.region) } : {}),
    ...(stringValue(response.createdAt) ? { startedAt: stringValue(response.createdAt) } : {}),
  };
}

function assertSteelSessionOptions(options: SessionOptions): void {
  if (options.projectId) throw new UnsupportedOptionError("projectId", PROVIDER);
  if (options.contextId) throw new UnsupportedOptionError("contextId", PROVIDER);
  if (options.keepAlive !== undefined) throw new UnsupportedOptionError("keepAlive", PROVIDER);
  if (options.recording !== undefined) throw new UnsupportedOptionError("recording", PROVIDER);
  if (options.logSession !== undefined) throw new UnsupportedOptionError("logSession", PROVIDER);
  if (options.allowedDomains) throw new UnsupportedOptionError("allowedDomains", PROVIDER);
  if (options.metadata) throw new UnsupportedOptionError("metadata", PROVIDER);
  if (options.executablePath) throw new UnsupportedOptionError("executablePath", PROVIDER);
}

function assertSteelScrapeOptions(source: BrowserSource, options: RenderOptions): void {
  if (!sourceRecord(source).url) throw new UnsupportedOptionError("inline HTML source", PROVIDER);
  for (const [key, value] of Object.entries({
    headers: options.headers,
    cookies: options.cookies,
    viewport: options.viewport,
    userAgent: options.userAgent,
    gotoOptions: options.gotoOptions,
    waitForSelector: options.waitForSelector,
    addScriptTag: options.addScriptTag,
    addStyleTag: options.addStyleTag,
    setExtraHTTPHeaders: options.setExtraHTTPHeaders,
    authenticate: options.authenticate,
  })) {
    if (value !== undefined) throw new UnsupportedOptionError(key, PROVIDER);
  }
  if (options.proxy !== undefined && typeof options.proxy !== "boolean") {
    throw new UnsupportedOptionError("proxy configuration", PROVIDER);
  }
}

function assertSteelArtifactOptions(
  source: BrowserSource,
  options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number; landscape?: boolean; printBackground?: boolean },
  operation: "screenshot" | "pdf",
): void {
  assertSteelScrapeOptions(source, options);
  if (operation === "screenshot") {
    if (options.format !== undefined && options.format !== "png") throw new UnsupportedOptionError("format (Steel returns PNG)", PROVIDER);
    if (options.selector !== undefined) throw new UnsupportedOptionError("selector", PROVIDER);
    if (options.quality !== undefined) throw new UnsupportedOptionError("quality", PROVIDER);
  }
  if (operation === "pdf") {
    if (options.landscape !== undefined) throw new UnsupportedOptionError("landscape", PROVIDER);
    if (options.printBackground !== undefined) throw new UnsupportedOptionError("printBackground", PROVIDER);
  }
}

function artifactBody(
  source: BrowserSource,
  options: RenderOptions,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...sourceRecord(source),
    ...(options.waitForTimeout === undefined ? {} : { delay: options.waitForTimeout }),
    ...(options.proxy === undefined ? {} : { useProxy: options.proxy }),
    ...extras,
    ...options.providerOptions,
  };
}

function steelStatus(value: string): string {
  const status = value.toLowerCase().replace(/-/g, "_");
  if (["active", "running", "ready", "pending"].includes(status)) return "live";
  if (["closed", "stopped", "completed", "timed_out"].includes(status)) return "released";
  if (status === "failed") return "failed";
  throw new BrowserSdkError("INVALID_OPTION", `Steel does not recognize session status ${value}.`, { provider: PROVIDER });
}

function normalizeStatus(value: unknown): BrowserSessionInfo["status"] {
  const status = String(value ?? "live").toLowerCase();
  if (status === "live" || status === "running" || status === "active") return "running";
  if (status === "released" || status === "closed") return "closed";
  if (status === "failed") return "failed";
  return "pending";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeFormat(value: ScreenshotFormat | undefined, contentType: string): ScreenshotFormat {
  if (value) return value;
  if (contentType.includes("jpeg")) return "jpeg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}
