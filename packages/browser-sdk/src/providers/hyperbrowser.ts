import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestJson } from "../http.js";
import {
  assertSupportedSessionOptions,
  assertViewportWithoutScale,
  isRecord,
  minutesFromMilliseconds,
} from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  ProviderContext,
  SessionOptions,
} from "../types.js";

export interface HyperbrowserConfig {
  apiKey: string;
  baseUrl?: string;
}

interface HyperbrowserSession {
  id?: unknown;
  status?: unknown;
  wsEndpoint?: unknown;
  liveUrl?: unknown;
  liveDomain?: unknown;
  sessionUrl?: unknown;
  webdriverEndpoint?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  createdAt?: unknown;
  launchState?: unknown;
  creditBreakdown?: unknown;
}

interface HyperbrowserListResponse {
  sessions?: unknown;
  totalCount?: unknown;
  page?: unknown;
  perPage?: unknown;
}

const PROVIDER = "hyperbrowser";

export function hyperbrowser(config: HyperbrowserConfig): BrowserProvider {
  if (!config.apiKey?.trim()) {
    throw new BrowserSdkError("INVALID_CONFIGURATION", "hyperbrowser requires apiKey.", { provider: PROVIDER });
  }
  const baseUrl = (config.baseUrl ?? "https://api.hyperbrowser.ai").replace(/\/$/, "");
  const auth = { "x-api-key": config.apiKey };

  return {
    name: PROVIDER,
    capabilities: ["session"],
    cost: 8,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertSupportedSessionOptions(options, PROVIDER, [
        "profileId",
        "region",
        "timeoutMs",
        "proxy",
        "viewport",
        "recording",
        "logSession",
        "stealth",
        "solveCaptchas",
        "allowedDomains",
      ]);
      assertViewportWithoutScale(options.viewport, PROVIDER);
      const timeoutMinutes = minutesFromMilliseconds(options.timeoutMs, PROVIDER, "timeoutMs");
      const generated: Record<string, unknown> = {
        ...(options.profileId ? { profile: { id: options.profileId } } : {}),
        ...(options.region ? { region: options.region } : {}),
        ...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
        ...(options.proxy === undefined ? {} : proxyBody(options.proxy)),
        ...(options.viewport ? { screen: { width: options.viewport.width, height: options.viewport.height } } : {}),
        ...(options.recording === undefined ? {} : { enableWebRecording: options.recording }),
        ...(options.logSession === undefined ? {} : { enableLogCapture: options.logSession }),
        ...(options.stealth === undefined ? {} : { useStealth: options.stealth }),
        ...(options.solveCaptchas === undefined ? {} : { solveCaptchas: options.solveCaptchas }),
        ...(options.allowedDomains ? { allowOut: [...options.allowedDomains] } : {}),
      };
      const response = await requestJson<HyperbrowserSession>(context, `${baseUrl}/api/session`, {
        ...jsonInit({ ...generated, ...options.providerOptions }, auth),
      }, PROVIDER);
      return mapSession(response);
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<HyperbrowserSession>(context, `${baseUrl}/api/session/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapSession(response, id);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const requested = options.limit ?? 50;
      const pageSize = Math.min(requested, 100);
      const sessions: BrowserSessionInfo[] = [];
      for (let page = 1; sessions.length < requested; page += 1) {
        const url = new URL(`${baseUrl}/api/sessions`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(pageSize));
        if (options.status) url.searchParams.set("status", options.status);
        const response = await requestJson<HyperbrowserListResponse>(context, url.href, {
          method: "GET",
          headers: { Accept: "application/json", ...auth },
        }, PROVIDER);
        const items = Array.isArray(response.sessions) ? response.sessions : [];
        sessions.push(...items.map((item) => mapSession(item)).filter((item): item is BrowserSessionInfo => Boolean(item)));
        const total = typeof response.totalCount === "number" ? response.totalCount : undefined;
        if (items.length < pageSize || (total !== undefined && page * pageSize >= total)) break;
      }
      return sessions.slice(0, requested);
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await request(context, `${baseUrl}/api/session/${encodeURIComponent(id)}/stop`, {
        method: "PUT",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
    },
  };
}

function proxyBody(value: boolean | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === "boolean") return { useProxy: value };
  const allowed = new Set([
    "server",
    "host",
    "port",
    "protocol",
    "username",
    "password",
    "country",
    "proxyCountry",
    "state",
    "city",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new UnsupportedOptionError(`proxy.${unknown[0]}`, PROVIDER);
  const result: Record<string, unknown> = { useProxy: true };
  const server = typeof value.server === "string"
    ? value.server
    : typeof value.host === "string" && value.port !== undefined
      ? `${typeof value.protocol === "string" ? value.protocol : "http"}://${value.host}:${String(value.port)}`
      : undefined;
  if (server) result.proxyServer = server;
  if (typeof value.username === "string") result.proxyServerUsername = value.username;
  if (typeof value.password === "string") result.proxyServerPassword = value.password;
  if (typeof value.country === "string") result.proxyCountry = value.country;
  if (typeof value.proxyCountry === "string") result.proxyCountry = value.proxyCountry;
  if (typeof value.state === "string") result.proxyState = value.state;
  if (typeof value.city === "string") result.proxyCity = value.city;
  return result;
}

function mapSession(value: unknown, fallbackId?: string): BrowserSessionInfo {
  if (!isRecord(value)) throw new ProviderResponseError(PROVIDER, "Hyperbrowser returned an invalid session response.");
  const record = value as HyperbrowserSession;
  const id = stringValue(record.id) ?? fallbackId;
  if (!id) throw new ProviderResponseError(PROVIDER, "Hyperbrowser returned no session id.");
  const launchState = isRecord(record.launchState) ? record.launchState : undefined;
  return {
    id,
    provider: PROVIDER,
    status: normalizeStatus(record.status),
    ...(stringValue(record.wsEndpoint) ? { connectUrl: stringValue(record.wsEndpoint) } : {}),
    ...(stringValue(record.webdriverEndpoint) ? { debuggerUrl: stringValue(record.webdriverEndpoint) } : {}),
    ...(stringValue(record.liveUrl) ? { dashboardUrl: stringValue(record.liveUrl) } : stringValue(record.sessionUrl) ? { dashboardUrl: stringValue(record.sessionUrl) } : {}),
    ...(typeof launchState?.region === "string" ? { region: launchState.region } : {}),
    ...(dateValue(record.startTime) ? { startedAt: dateValue(record.startTime) } : typeof record.createdAt === "string" ? { startedAt: record.createdAt } : {}),
    ...(dateValue(record.endTime) ? { endedAt: dateValue(record.endTime) } : {}),
  };
}

function normalizeStatus(value: unknown): BrowserSessionInfo["status"] {
  const status = String(value ?? "pending").toLowerCase().replace(/-/g, "_");
  if (["active", "running"].includes(status)) return "running";
  if (["closed", "close_error", "stopped"].includes(status)) return "closed";
  if (["error", "failed"].includes(status)) return "failed";
  return "pending";
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
