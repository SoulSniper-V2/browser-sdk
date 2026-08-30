import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, requestJson } from "../http.js";
import { firstHeading, htmlToMarkdown, sourceRecord } from "../utils.js";
import { assertViewportWithoutScale } from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  MarkdownResult,
  ProviderContext,
  RenderOptions,
  SessionOptions,
} from "../types.js";

export interface BrowserbaseConfig {
  apiKey: string;
  projectId?: string;
  baseUrl?: string;
}

interface BrowserbaseSessionResponse {
  id?: unknown;
  status?: unknown;
  connectUrl?: unknown;
  debuggerUrl?: unknown;
  region?: unknown;
  expiresAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  projectId?: unknown;
  contextId?: unknown;
  userMetadata?: unknown;
  [key: string]: unknown;
}

interface BrowserbaseFetchResponse {
  success?: boolean;
  content?: unknown;
  title?: unknown;
  url?: unknown;
  statusCode?: unknown;
  contentType?: unknown;
  error?: unknown;
}

const PROVIDER = "browserbase";

export function browserbase(config: BrowserbaseConfig): BrowserProvider {
  if (!config.apiKey?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "browserbase requires apiKey.", { provider: PROVIDER });
  const baseUrl = (config.baseUrl ?? "https://api.browserbase.com").replace(/\/$/, "");
  const auth = { "X-BB-API-Key": config.apiKey };

  return {
    name: PROVIDER,
    capabilities: ["session", "content", "markdown"],
    cost: 10,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertViewportWithoutScale(options.viewport, PROVIDER);
      if (options.proxy && typeof options.proxy !== "boolean") throw new UnsupportedOptionError("proxy configuration", PROVIDER);
      if (options.headless !== undefined) throw new UnsupportedOptionError("headless", PROVIDER);
      if (options.keepAliveMs !== undefined) throw new UnsupportedOptionError("keepAliveMs", PROVIDER);
      if (options.executablePath) throw new UnsupportedOptionError("executablePath", PROVIDER);
      const timeoutMs = options.timeoutMs ?? 3_600_000;
      const timeoutSeconds = Math.round(timeoutMs / 1_000);
      if (timeoutSeconds < 60 || timeoutSeconds > 21_600) {
        throw new BrowserSdkError("INVALID_OPTION", "Browserbase session timeout must be between 60 seconds and 6 hours.", { provider: PROVIDER });
      }
      const body: Record<string, unknown> = {
        timeout: timeoutSeconds,
        keepAlive: options.keepAlive ?? false,
        proxies: options.proxy ?? false,
        browserSettings: {
          ...(options.viewport ? { viewport: options.viewport } : {}),
          ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          ...(options.recording === undefined ? {} : { recordSession: options.recording }),
          ...(options.logSession === undefined ? {} : { logSession: options.logSession }),
          ...(options.stealth === undefined ? {} : { advancedStealth: options.stealth }),
          ...(options.solveCaptchas === undefined ? {} : { solveCaptchas: options.solveCaptchas }),
          ...(options.allowedDomains ? { allowedDomains: options.allowedDomains } : {}),
        },
        ...(config.projectId || options.projectId ? { projectId: options.projectId ?? config.projectId } : {}),
        ...(options.contextId || options.profileId ? { contextId: options.contextId ?? options.profileId } : {}),
        ...(options.region ? { region: options.region } : {}),
        ...(options.metadata ? { userMetadata: options.metadata } : {}),
        ...options.providerOptions,
      };
      const response = await requestJson<BrowserbaseSessionResponse>(context, `${baseUrl}/v1/sessions`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      return mapSession(response);
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<BrowserbaseSessionResponse>(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapSession(response);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const url = new URL(`${baseUrl}/v1/sessions`);
      if (options.status) url.searchParams.set("status", options.status);
      const response = await requestJson<BrowserbaseSessionResponse[]>(context, url.href, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return response.slice(0, options.limit ?? 50).map(mapSession);
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await requestJson<BrowserbaseSessionResponse>(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
        ...jsonInit({ status: "REQUEST_RELEASE", ...(config.projectId ? { projectId: config.projectId } : {}) }, auth),
      }, PROVIDER);
    },
    async content(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult> {
      const content = await fetchPage(source, options, context, baseUrl, auth);
      return {
        source,
        provider: PROVIDER,
        latencyMs: content.latencyMs,
        content: content.value,
        ...(content.title ? { title: content.title } : {}),
        ...(content.finalUrl ? { finalUrl: content.finalUrl } : {}),
        ...(content.statusCode === undefined ? {} : { statusCode: content.statusCode }),
      };
    },
    async markdown(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<MarkdownResult> {
      const content = await fetchPage(source, options, context, baseUrl, auth);
      return {
        source,
        provider: PROVIDER,
        latencyMs: content.latencyMs,
        markdown: htmlToMarkdown(content.value),
        ...(content.title || firstHeading(content.value) ? { title: content.title ?? firstHeading(content.value) } : {}),
        ...(content.finalUrl ? { finalUrl: content.finalUrl } : {}),
        ...(content.statusCode === undefined ? {} : { statusCode: content.statusCode }),
      };
    },
  };
}

async function fetchPage(
  source: BrowserSource,
  options: RenderOptions & { schema?: Record<string, unknown> },
  context: ProviderContext,
  baseUrl: string,
  auth: Record<string, string>,
): Promise<{ value: string; title?: string; finalUrl?: string; statusCode?: number; latencyMs: number }> {
  const sourceInput = sourceRecord(source);
  if (!sourceInput.url) throw new UnsupportedOptionError("inline HTML source", PROVIDER);
  if (options.proxy && typeof options.proxy !== "boolean") throw new UnsupportedOptionError("proxy configuration", PROVIDER);
  if (options.headers || options.cookies || options.userAgent || options.viewport || options.gotoOptions || options.waitForSelector || options.waitForTimeout !== undefined || options.addScriptTag || options.addStyleTag || options.setExtraHTTPHeaders || options.authenticate) {
    throw new UnsupportedOptionError("render controls on Browserbase Fetch", PROVIDER);
  }
  const startedAt = Date.now();
  const response = await requestJson<BrowserbaseFetchResponse>(context, `${baseUrl}/v1/fetch`, {
    ...jsonInit({
      url: sourceInput.url,
      allowRedirects: true,
      ...(options.proxy ? { proxies: options.proxy } : {}),
      ...(options.schema ? { schema: options.schema } : {}),
      ...options.providerOptions,
    }, auth),
  }, PROVIDER);
  if (response.success === false || response.error) {
    throw new ProviderResponseError(PROVIDER, typeof response.error === "string" ? response.error : "Browserbase returned a failed response envelope.");
  }
  if (typeof response.content !== "string") throw new ProviderResponseError(PROVIDER, "Browserbase returned no content.");
  return {
    value: response.content,
    ...(typeof response.title === "string" ? { title: response.title || firstHeading(response.content) } : { title: firstHeading(response.content) }),
    ...(typeof response.url === "string" ? { finalUrl: response.url } : {}),
    ...(typeof response.statusCode === "number" ? { statusCode: response.statusCode } : {}),
    latencyMs: Date.now() - startedAt,
  };
}

function mapSession(response: BrowserbaseSessionResponse): BrowserSessionInfo {
  const id = stringValue(response.id);
  if (!id) throw new ProviderResponseError(PROVIDER, "Browserbase returned no session id.");
  const dashboardUrl = `https://browserbase.com/sessions/${encodeURIComponent(id)}`;
  return {
    id,
    provider: PROVIDER,
    status: normalizeStatus(response.status),
    ...(stringValue(response.connectUrl) ? { connectUrl: stringValue(response.connectUrl) } : {}),
    ...(stringValue(response.debuggerUrl) ? { debuggerUrl: stringValue(response.debuggerUrl) } : {}),
    dashboardUrl,
    ...(stringValue(response.region) ? { region: stringValue(response.region) } : {}),
    ...(stringValue(response.expiresAt) ? { expiresAt: stringValue(response.expiresAt) } : {}),
    ...(stringValue(response.startedAt) ? { startedAt: stringValue(response.startedAt) } : {}),
    ...(stringValue(response.endedAt) ? { endedAt: stringValue(response.endedAt) } : {}),
    ...(isRecord(response.userMetadata) ? { metadata: response.userMetadata } : {}),
  };
}

function normalizeStatus(value: unknown): BrowserSessionInfo["status"] {
  const status = String(value ?? "PENDING").toLowerCase();
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "timed_out") return "timed_out";
  if (status === "error") return "failed";
  return "pending";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
