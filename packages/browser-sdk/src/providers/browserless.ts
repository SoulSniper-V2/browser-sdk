import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestBytes, requestJson, requestText } from "../http.js";
import { firstHeading, htmlTitle, htmlToMarkdown, sourceRecord } from "../utils.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  MarkdownResult,
  PdfResult,
  ProviderContext,
  RenderOptions,
  ScreenshotFormat,
  ScreenshotResult,
  SessionOptions,
} from "../types.js";

export interface BrowserlessConfig {
  token: string;
  baseUrl?: string;
}

interface BrowserlessSessionResponse {
  id?: unknown;
  connect?: unknown;
  browserWSEndpoint?: unknown;
  stop?: unknown;
}

const PROVIDER = "browserless";

export function browserless(config: BrowserlessConfig): BrowserProvider {
  if (!config.token?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "browserless requires token.", { provider: PROVIDER });
  const baseUrl = (config.baseUrl ?? "https://production-sfo.browserless.io").replace(/\/$/, "");
  const endpoint = (path: string) => `${baseUrl}${path}?token=${encodeURIComponent(config.token)}`;
  const stopUrls = new Map<string, string>();

  return {
    name: PROVIDER,
    capabilities: ["session", "content", "markdown", "screenshot", "pdf"],
    cost: 6,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      if (options.projectId || options.contextId || options.region || options.logSession || options.solveCaptchas || options.allowedDomains || options.metadata) {
        throw new UnsupportedOptionError("session option", PROVIDER);
      }
      if (options.executablePath) throw new UnsupportedOptionError("executablePath", PROVIDER);
      const ttl = options.timeoutMs ?? 300_000;
      if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new BrowserSdkError("INVALID_OPTION", "Browserless timeoutMs must be a finite number > 0.", { provider: PROVIDER });
      }
      if (options.keepAliveMs !== undefined && options.keepAliveMs > ttl) {
        throw new BrowserSdkError("INVALID_OPTION", "Browserless keepAliveMs cannot exceed timeoutMs.", { provider: PROVIDER });
      }
      const body: Record<string, unknown> = {
        ttl,
        ...(options.keepAlive ? { processKeepAlive: Math.min(options.keepAliveMs ?? 60_000, ttl) } : options.keepAliveMs === undefined ? {} : { processKeepAlive: options.keepAliveMs }),
        ...(options.stealth === undefined ? {} : { stealth: options.stealth }),
        ...(options.headless === undefined ? {} : { headless: options.headless }),
        ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        ...(options.recording === undefined ? {} : { replay: options.recording }),
        ...(options.profileId ? { profile: options.profileId } : {}),
        ...options.providerOptions,
      };
      const response = await requestJson<BrowserlessSessionResponse>(context, endpoint("/session"), {
        ...jsonInit(body),
      }, PROVIDER);
      const id = stringValue(response.id);
      if (!id) throw new ProviderResponseError(PROVIDER, "Browserless returned no session id.");
      const connectUrl = stringValue(response.connect) ?? stringValue(response.browserWSEndpoint);
      if (!connectUrl) throw new ProviderResponseError(PROVIDER, "Browserless returned no session connection URL.");
      const stopUrl = stringValue(response.stop);
      if (stopUrl) stopUrls.set(id, stopUrl);
      return { id, provider: PROVIDER, status: "ready", connectUrl };
    },
    async content(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult> {
      const startedAt = Date.now();
      const response = await requestText(context, endpoint("/content"), {
        ...jsonInit(browserlessBody(source, options), { "Cache-Control": "no-cache" }),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        content: response,
        ...(htmlTitle(response) || firstHeading(response) ? { title: htmlTitle(response) ?? firstHeading(response) } : {}),
      };
    },
    async markdown(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<MarkdownResult> {
      const content = await this.content!(source, options, context);
      return {
        source,
        provider: PROVIDER,
        latencyMs: content.latencyMs,
        markdown: htmlToMarkdown(content.content),
        ...(content.title ? { title: content.title } : {}),
      };
    },
    async screenshot(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }, context: ProviderContext): Promise<ScreenshotResult> {
      const startedAt = Date.now();
      const response = await requestBytes(context, endpoint("/screenshot"), {
        ...jsonInit({
          ...browserlessBody(source, options),
          options: {
            ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
            ...(options.selector ? { selector: options.selector } : {}),
            ...(options.quality === undefined ? {} : { quality: options.quality }),
            ...(options.format ? { type: options.format } : {}),
          },
        }),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: response.data,
        contentType: response.contentType,
        format: normalizeFormat(options.format, response.contentType),
      };
    },
    async pdf(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean }, context: ProviderContext): Promise<PdfResult> {
      const startedAt = Date.now();
      const response = await requestBytes(context, endpoint("/pdf"), {
        ...jsonInit({
          ...browserlessBody(source, options),
          options: {
            ...(options.landscape === undefined ? {} : { landscape: options.landscape }),
            ...(options.printBackground === undefined ? {} : { printBackground: options.printBackground }),
          },
        }),
      }, PROVIDER);
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        data: response.data,
        contentType: "application/pdf",
      };
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      const stopUrl = stopUrls.get(id) ?? `${endpoint(`/session/${encodeURIComponent(id)}`)}&force=true`;
      const url = stopUrl.includes("force=") ? stopUrl : `${stopUrl}${stopUrl.includes("?") ? "&" : "?"}force=true`;
      await request(context, url, { method: "DELETE" }, PROVIDER);
      stopUrls.delete(id);
    },
  };
}

function browserlessBody(source: BrowserSource, options: RenderOptions): Record<string, unknown> {
  return {
    ...sourceRecord(source),
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(options.headers ? { setExtraHTTPHeaders: options.headers } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.gotoOptions ? { gotoOptions: options.gotoOptions } : {}),
    ...(options.waitForSelector ? { waitForSelector: { selector: options.waitForSelector } } : {}),
    ...(options.waitForTimeout === undefined ? {} : { waitForTimeout: options.waitForTimeout }),
    ...(options.addScriptTag ? { addScriptTag: options.addScriptTag } : {}),
    ...(options.addStyleTag ? { addStyleTag: options.addStyleTag } : {}),
    ...(options.setExtraHTTPHeaders ? { setExtraHTTPHeaders: options.setExtraHTTPHeaders } : {}),
    ...(options.authenticate ? { authenticate: options.authenticate } : {}),
    ...(options.cookies ? { cookies: options.cookies } : {}),
    ...(options.proxy ? { proxy: options.proxy } : {}),
    ...options.providerOptions,
  };
}

function normalizeFormat(value: ScreenshotFormat | undefined, contentType: string): ScreenshotFormat {
  if (value) return value;
  if (contentType.includes("jpeg")) return "jpeg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
