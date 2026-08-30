import { BrowserSdkError, UnsupportedOptionError } from "../errors.js";
import type { SessionOptions, Viewport } from "../types.js";

const SESSION_OPTION_KEYS = new Set<string>([
  "projectId",
  "contextId",
  "profileId",
  "region",
  "timeoutMs",
  "keepAlive",
  "keepAliveMs",
  "proxy",
  "viewport",
  "userAgent",
  "recording",
  "logSession",
  "stealth",
  "solveCaptchas",
  "allowedDomains",
  "metadata",
  "executablePath",
  "headless",
  "signal",
  "providerOptions",
]);

export function assertSupportedSessionOptions(
  options: SessionOptions,
  provider: string,
  supported: readonly (keyof SessionOptions)[],
): void {
  const allowed = new Set<string>(supported);
  allowed.add("signal");
  allowed.add("providerOptions");
  for (const key of SESSION_OPTION_KEYS) {
    if (options[key as keyof SessionOptions] !== undefined && !allowed.has(key)) {
      throw new UnsupportedOptionError(key, provider);
    }
  }
}

export function assertViewportWithoutScale(viewport: Viewport | undefined, provider: string): void {
  if (viewport?.deviceScaleFactor !== undefined) {
    throw new UnsupportedOptionError("viewport.deviceScaleFactor", provider);
  }
}

export function minutesFromMilliseconds(
  value: number | undefined,
  provider: string,
  label: string,
  maximum?: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 60_000) {
    throw new BrowserSdkError("INVALID_OPTION", `${provider} ${label} must be at least 60000ms.`, { provider });
  }
  const minutes = Math.ceil(value / 60_000);
  if (maximum !== undefined && minutes > maximum) {
    throw new BrowserSdkError("INVALID_OPTION", `${provider} ${label} cannot exceed ${maximum} minutes.`, { provider });
  }
  return minutes;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function jsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function metadataAsStrings(metadata: Record<string, unknown> | undefined, provider: string, maximum = 10): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata);
  if (entries.length > maximum) {
    throw new BrowserSdkError("INVALID_OPTION", `${provider} metadata supports at most ${maximum} keys.`, { provider });
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, jsonString(value)]));
}

export function mergeProviderObject(
  generated: Record<string, unknown>,
  providerOptions: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> {
  const override = providerOptions?.[key];
  return {
    ...generated,
    ...(isRecord(override) ? override : {}),
  };
}
