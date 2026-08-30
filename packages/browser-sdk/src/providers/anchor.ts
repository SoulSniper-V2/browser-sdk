import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { jsonInit, request, requestJson } from "../http.js";
import {
  assertSupportedSessionOptions,
  assertViewportWithoutScale,
  isRecord,
  jsonString,
  mergeProviderObject,
  minutesFromMilliseconds,
} from "./shared.js";
import type {
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ProviderContext,
  SessionOptions,
} from "../types.js";

export interface AnchorConfig {
  apiKey: string;
  baseUrl?: string;
}

interface AnchorEnvelope<T> {
  data?: T;
  error?: unknown;
}

interface AnchorCreateData {
  id?: unknown;
  cdp_url?: unknown;
  live_view_url?: unknown;
}

interface AnchorSessionRecord {
  id?: unknown;
  session_id?: unknown;
  status?: unknown;
  created_at?: unknown;
  ended_at?: unknown;
  tags?: unknown;
  configuration?: unknown;
  user_configuration?: unknown;
}

interface AnchorListData {
  sessions?: unknown;
  total?: unknown;
}

const PROVIDER = "anchor";

export function anchor(config: AnchorConfig): BrowserProvider {
  if (!config.apiKey?.trim()) {
    throw new BrowserSdkError("INVALID_CONFIGURATION", "anchor requires apiKey.", { provider: PROVIDER });
  }
  const baseUrl = (config.baseUrl ?? "https://api.anchorbrowser.io").replace(/\/$/, "");
  const auth = { "anchor-api-key": config.apiKey };

  return {
    name: PROVIDER,
    capabilities: ["session"],
    cost: 7,
    async createSession(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo> {
      assertSupportedSessionOptions(options, PROVIDER, [
        "timeoutMs",
        "keepAliveMs",
        "proxy",
        "viewport",
        "recording",
        "stealth",
        "solveCaptchas",
        "metadata",
        "headless",
      ]);
      assertViewportWithoutScale(options.viewport, PROVIDER);
      const timeoutMinutes = minutesFromMilliseconds(options.timeoutMs, PROVIDER, "timeoutMs");
      const idleTimeoutMinutes = minutesFromMilliseconds(options.keepAliveMs, PROVIDER, "keepAliveMs");
      const providerOptions = options.providerOptions;
      const session: Record<string, unknown> = {
        ...(timeoutMinutes === undefined && idleTimeoutMinutes === undefined ? {} : {
          timeout: {
            ...(timeoutMinutes === undefined ? {} : { max_duration: timeoutMinutes }),
            ...(idleTimeoutMinutes === undefined ? {} : { idle_timeout: idleTimeoutMinutes }),
          },
        }),
        ...(options.proxy === undefined ? {} : { proxy: anchorProxy(options.proxy) }),
        ...(options.recording === undefined ? {} : { recording: { active: options.recording } }),
        ...(options.metadata ? { tags: Object.entries(options.metadata).map(([key, value]) => `${key}=${jsonString(value)}`) } : {}),
      };
      const browser: Record<string, unknown> = {
        ...(options.viewport ? { viewport: { width: options.viewport.width, height: options.viewport.height } } : {}),
        ...(options.stealth === undefined ? {} : { extra_stealth: { active: options.stealth } }),
        ...(options.solveCaptchas === undefined ? {} : { captcha_solver: { active: options.solveCaptchas } }),
        ...(options.headless === undefined ? {} : { headless: { active: options.headless } }),
      };
      const body = {
        ...providerOptions,
        session: mergeProviderObject(session, providerOptions, "session"),
        browser: mergeProviderObject(browser, providerOptions, "browser"),
      };
      const response = await requestJson<AnchorEnvelope<AnchorCreateData>>(context, `${baseUrl}/v1/sessions`, {
        ...jsonInit(body, auth),
      }, PROVIDER);
      const data = unwrap(response, PROVIDER);
      const id = stringValue(data.id);
      if (!id) throw new ProviderResponseError(PROVIDER, "Anchor returned no session id.");
      return {
        id,
        provider: PROVIDER,
        status: "ready",
        ...(stringValue(data.cdp_url) ? { connectUrl: stringValue(data.cdp_url) } : {}),
        ...(stringValue(data.live_view_url) ? { dashboardUrl: stringValue(data.live_view_url) } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      };
    },
    async getSession(id: string, context: ProviderContext): Promise<BrowserSessionInfo> {
      const response = await requestJson<AnchorEnvelope<AnchorSessionRecord>>(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
      return mapSession(unwrap(response, PROVIDER), id);
    },
    async listSessions(options, context): Promise<readonly BrowserSessionInfo[]> {
      const requested = options.limit ?? 50;
      const pageSize = requested <= 10 ? 10 : requested <= 20 ? 20 : 50;
      const sessions: BrowserSessionInfo[] = [];
      const pages = Math.ceil(requested / pageSize);
      for (let page = 1; page <= pages && sessions.length < requested; page += 1) {
        const url = new URL(`${baseUrl}/v1/sessions`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(pageSize));
        if (options.status) url.searchParams.set("status", options.status);
        const response = await requestJson<AnchorEnvelope<AnchorListData>>(context, url.href, {
          method: "GET",
          headers: { Accept: "application/json", ...auth },
        }, PROVIDER);
        const data = unwrap(response, PROVIDER);
        const items = Array.isArray(data.sessions) ? data.sessions : [];
        sessions.push(...items.map((item) => mapSession(item)));
        if (items.length < pageSize) break;
      }
      return sessions.slice(0, requested);
    },
    async closeSession(id: string, context: ProviderContext): Promise<void> {
      await request(context, `${baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json", ...auth },
      }, PROVIDER);
    },
  };
}

function anchorProxy(value: boolean | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === "boolean") {
    return { active: value, ...(value ? { type: "anchor_proxy" } : {}) };
  }
  const allowed = new Set([
    "active",
    "type",
    "countryCode",
    "country_code",
    "region",
    "city",
    "server",
    "host",
    "port",
    "protocol",
    "username",
    "password",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new UnsupportedOptionError(`proxy.${unknown[0]}`, PROVIDER);
  if (value.type !== undefined && value.type !== "anchor_proxy" && value.type !== "custom") {
    throw new UnsupportedOptionError("proxy.type", PROVIDER);
  }
  const active = value.active === undefined ? true : value.active;
  if (value.type === "custom" || typeof value.server === "string" || typeof value.host === "string") {
    const server = typeof value.server === "string"
      ? value.server
      : `${typeof value.protocol === "string" ? value.protocol : "http"}://${String(value.host)}:${String(value.port ?? "")}`;
    if (!server || server.endsWith(":")) throw new BrowserSdkError("INVALID_OPTION", "Anchor custom proxy requires server or host and port.", { provider: PROVIDER });
    return {
      type: "custom",
      active,
      server,
      ...(typeof value.username === "string" ? { username: value.username } : {}),
      ...(typeof value.password === "string" ? { password: value.password } : {}),
    };
  }
  return {
    type: "anchor_proxy",
    active,
    ...(typeof value.countryCode === "string" ? { country_code: value.countryCode.toLowerCase() } : {}),
    ...(typeof value.country_code === "string" ? { country_code: value.country_code.toLowerCase() } : {}),
    ...(typeof value.region === "string" ? { region: value.region } : {}),
    ...(typeof value.city === "string" ? { city: value.city } : {}),
  };
}

function unwrap<T>(response: AnchorEnvelope<T>, provider: string): T {
  if (!response || response.data === undefined) {
    throw new ProviderResponseError(provider, "Anchor returned an unsuccessful response.", { error: response?.error });
  }
  return response.data;
}

function mapSession(value: unknown, fallbackId?: string): BrowserSessionInfo {
  if (!isRecord(value)) throw new ProviderResponseError(PROVIDER, "Anchor returned an invalid session record.");
  const id = stringValue(value.id) ?? stringValue(value.session_id) ?? fallbackId;
  if (!id) throw new ProviderResponseError(PROVIDER, "Anchor returned a session record without an id.");
  const record = value as AnchorSessionRecord;
  const tags = Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
  return {
    id,
    provider: PROVIDER,
    status: normalizeStatus(record.status),
    ...(stringValue(record.created_at) ? { startedAt: stringValue(record.created_at) } : {}),
    ...(stringValue(record.ended_at) ? { endedAt: stringValue(record.ended_at) } : {}),
    ...(tags?.length ? { metadata: { tags } } : {}),
  };
}

function normalizeStatus(value: unknown): BrowserSessionInfo["status"] {
  const status = String(value ?? "pending").toLowerCase().replace(/-/g, "_");
  if (["active", "running", "ready", "in_progress"].includes(status)) return "running";
  if (["completed", "complete", "success"].includes(status)) return "completed";
  if (["closed", "stopped", "ended", "terminated"].includes(status)) return "closed";
  if (["timed_out", "timeout"].includes(status)) return "timed_out";
  if (["failed", "error"].includes(status)) return "failed";
  return "pending";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
