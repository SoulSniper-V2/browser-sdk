import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestJson } from "../http.js";
import {
  assertSupportedSessionOptions,
  assertViewportWithoutScale,
  isRecord,
  metadataAsStrings,
  minutesFromMilliseconds,
} from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  ProviderContext,
  SessionOptions,
} from "../types.js";

export interface BrowserUseConfig {
  apiKey: string;
  baseUrl?: string;
}

interface BrowserUseSession {
  id?: unknown;
  status?: unknown;
  timeoutAt?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  liveUrl?: unknown;
  cdpUrl?: unknown;
  metadata?: unknown;
}

interface BrowserUseListResponse {
  items?: unknown;
  totalItems?: unknown;
  pageNumber?: unknown;
  pageSize?: unknown;
}

const PROVIDER = "browser-use";

export function browserUse(config: BrowserUseConfig): BrowserProvider {
  if (!config.apiKey?.trim()) {
    throw new BrowserSdkError("INVALID_CONFIGURATION", "browser-use requires apiKey.", { provider: PROVIDER });
  }
  const baseUrl = (config.baseUrl ?? "https://api.browser-use.com/api/v3").replace(/\/$/, "");
  const auth = { "X-Browser-Use-API-Key": config.apiKey };

  return {
    name: PROVIDER,
    capabilities: ["session"],
    cost: 9,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertSupportedSessionOptions(options, PROVIDER, [
        "profileId",
        "region",
        "timeoutMs",
        "proxy",
        "viewport",
        "recording",
        "metadata",
      ]);
      assertViewportWithoutScale(options.viewport, PROVIDER);
      const timeout = minutesFromMilliseconds(options.timeoutMs, PROVIDER, "timeoutMs", 240) ?? 60;
      const metadata = metadataAsStrings(options.metadata, PROVIDER);
      const body: Record<string, unknown> = {
        timeout,
        allowResizing: false,
        enableRecording: options.recording ?? false,
        ...(options.profileId ? { profileId: options.profileId } : {}),
        ...(options.viewport ? {
          browserScreenWidth: options.viewport.width,
          browserScreenHeight: options.viewport.height,
        } : {}),
        ...(metadata ? { metadata } : {}),
        ...proxyBody(options.proxy, options.region),
        ...options.providerOptions,
      };
      const response = await requestJson<BrowserUseSession>(context, `${baseUrl}/browsers`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      return mapSession(response);
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<BrowserUseSession>(context, `${baseUrl}/browsers/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapSession(response, id);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const requested = options.limit ?? 50;
      const pageSize = Math.min(requested, 100);
      const filterBy = browserUseStatusFilter(options.status);
      const sessions: BrowserSessionInfo[] = [];
      for (let page = 1; sessions.length < requested; page += 1) {
        const url = new URL(`${baseUrl}/browsers`);
        url.searchParams.set("pageSize", String(pageSize));
        url.searchParams.set("pageNumber", String(page));
        if (filterBy) url.searchParams.set("filterBy", filterBy);
        const response = await requestJson<BrowserUseListResponse>(context, url.href, {
          method: "GET",
          headers: { Accept: "application/json", ...auth },
        }, PROVIDER);
        const items = Array.isArray(response.items) ? response.items : [];
        sessions.push(...items.map((item) => mapSession(item)).filter((item): item is BrowserSessionInfo => Boolean(item)));
        const total = typeof response.totalItems === "number" ? response.totalItems : undefined;
        if (items.length < pageSize || (total !== undefined && page * pageSize >= total)) break;
      }
      return sessions.slice(0, requested);
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await requestJson<BrowserUseSession>(context, `${baseUrl}/browsers/${encodeURIComponent(id)}`, {
        ...jsonInit({ action: "stop" }, auth),
        method: "PATCH",
      }, PROVIDER);
    },
  };
}

function proxyBody(value: boolean | Record<string, unknown> | undefined, region: string | undefined): Record<string, unknown> {
  if (value === false) {
    if (region) throw new UnsupportedOptionError("region when proxy is disabled", PROVIDER);
    return { proxyCountryCode: null };
  }
  if (value === undefined || value === true) {
    return { proxyCountryCode: normalizeCountryCode(region ?? "us") };
  }

  const allowed = new Set(["host", "port", "server", "protocol", "username", "password", "ignoreCertErrors", "countryCode", "country_code"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new UnsupportedOptionError(`proxy.${unknown[0]}`, PROVIDER);
  const custom = customProxy(value);
  const country = typeof value.countryCode === "string"
    ? value.countryCode
    : typeof value.country_code === "string"
      ? value.country_code
      : region;
  if (!value.host && !value.server && country) return { proxyCountryCode: normalizeCountryCode(country) };
  return {
    proxyCountryCode: country ? normalizeCountryCode(country) : null,
    customProxy: custom,
  };
}

function customProxy(value: Record<string, unknown>): Record<string, unknown> {
  let server = typeof value.server === "string" ? value.server : undefined;
  let host = typeof value.host === "string" ? value.host : undefined;
  let port = typeof value.port === "number" ? value.port : undefined;
  if (server && (!host || port === undefined)) {
    try {
      const parsed = new URL(server);
      host = parsed.hostname;
      port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    } catch {
      throw new BrowserSdkError("INVALID_OPTION", "Browser Use custom proxy server must be a valid URL.", { provider: PROVIDER });
    }
  }
  if (!host || port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new BrowserSdkError("INVALID_OPTION", "Browser Use custom proxy requires host and a valid port.", { provider: PROVIDER });
  }
  return {
    host,
    port,
    ...(typeof value.username === "string" ? { username: value.username } : {}),
    ...(typeof value.password === "string" ? { password: value.password } : {}),
    ignoreCertErrors: value.ignoreCertErrors === true,
  };
}

function browserUseStatusFilter(value: string | undefined): "active" | "stopped" | undefined {
  if (!value) return undefined;
  const status = value.toLowerCase().replace(/-/g, "_");
  if (["active", "running", "ready", "pending"].includes(status)) return "active";
  if (["stopped", "closed", "completed", "failed", "timed_out"].includes(status)) return "stopped";
  throw new BrowserSdkError("INVALID_OPTION", `Browser Use does not recognize session status ${value}.`, { provider: PROVIDER });
}

function mapSession(value: unknown, fallbackId?: string): BrowserSessionInfo {
  if (!isRecord(value)) throw new ProviderResponseError(PROVIDER, "Browser Use returned an invalid session response.");
  const record = value as BrowserUseSession;
  const id = stringValue(record.id) ?? fallbackId;
  if (!id) throw new ProviderResponseError(PROVIDER, "Browser Use returned no session id.");
  return {
    id,
    provider: PROVIDER,
    status: normalizeStatus(record.status),
    ...(stringValue(record.cdpUrl) ? { connectUrl: stringValue(record.cdpUrl) } : {}),
    ...(stringValue(record.liveUrl) ? { dashboardUrl: stringValue(record.liveUrl) } : {}),
    ...(stringValue(record.timeoutAt) ? { expiresAt: stringValue(record.timeoutAt) } : {}),
    ...(stringValue(record.startedAt) ? { startedAt: stringValue(record.startedAt) } : {}),
    ...(stringValue(record.finishedAt) ? { endedAt: stringValue(record.finishedAt) } : {}),
    ...(isRecord(record.metadata) ? { metadata: record.metadata } : {}),
  };
}

function normalizeStatus(value: unknown): BrowserSessionInfo["status"] {
  const status = String(value ?? "pending").toLowerCase().replace(/-/g, "_");
  if (status === "active") return "running";
  if (status === "stopped") return "closed";
  return "pending";
}

function normalizeCountryCode(value: string): string {
  const country = value.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    throw new BrowserSdkError("INVALID_OPTION", "Browser Use region must be a two-letter country code.", { provider: PROVIDER });
  }
  return country;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
