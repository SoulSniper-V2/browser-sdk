export type BrowserSdkErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_SOURCE"
  | "INVALID_OPTION"
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "ABORTED"
  | "UNSUPPORTED_OPERATION"
  | "UNSUPPORTED_OPTION"
  | "INVALID_RESPONSE"
  | "DEPENDENCY_MISSING"
  | "SESSION_FAILED"
  | "ALL_PROVIDERS_FAILED"
  | "UNKNOWN_ERROR";

export interface BrowserSdkErrorOptions {
  provider?: string;
  statusCode?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

const SECRET_KEYS = /^(token|api[_-]?token|api[_-]?key|authorization|secret|password|private[_-]?key|cookie)$/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_QUERY = /([?&](?:token|api[_-]?token|api[_-]?key|secret|password|authorization)=)[^&#\s]+/gi;
const MAX_STRING = 1_000;

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.replace(BEARER, "Bearer [REDACTED]").replace(SECRET_QUERY, "$1[REDACTED]").slice(0, MAX_STRING);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, seen));
  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 50)) {
    safe[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redact(child, seen);
  }
  return safe;
}

export class BrowserSdkError extends Error {
  readonly code: BrowserSdkErrorCode;
  readonly provider?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: BrowserSdkErrorCode, message: string, options: BrowserSdkErrorOptions = {}) {
    const safeCause = options.cause instanceof BrowserSdkError
      ? options.cause
      : options.cause instanceof Error
        ? new Error(String(redact(options.cause.message)))
        : redact(options.cause);
    super(String(redact(message)), { cause: safeCause });
    this.name = "BrowserSdkError";
    this.code = code;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.details = options.details ? redact(options.details) as Record<string, unknown> : undefined;
    this.cause = safeCause;
  }
}

export class RateLimitError extends BrowserSdkError {
  constructor(message: string, options: BrowserSdkErrorOptions = {}) {
    super("RATE_LIMITED", message, { ...options, retryable: true });
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends BrowserSdkError {
  constructor(provider?: string, timeoutMs?: number, cause?: unknown) {
    super("TIMEOUT", timeoutMs === undefined
      ? `The ${provider ?? "browser"} operation timed out.`
      : `The ${provider ?? "browser"} operation exceeded ${timeoutMs}ms.`, {
      provider,
      retryable: true,
      cause,
    });
    this.name = "TimeoutError";
  }
}

export class CapabilityError extends BrowserSdkError {
  constructor(operation: string, provider?: string) {
    super("UNSUPPORTED_OPERATION", provider
      ? `${provider} does not support ${operation}.`
      : `No configured provider supports ${operation}.`, {
        provider,
      });
    this.name = "CapabilityError";
  }
}

export class UnsupportedOptionError extends BrowserSdkError {
  constructor(option: string, provider: string) {
    super("UNSUPPORTED_OPTION", `${provider} cannot honor option ${option}.`, { provider });
    this.name = "UnsupportedOptionError";
  }
}

export class ProviderResponseError extends BrowserSdkError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super("INVALID_RESPONSE", message, { provider, ...(details ? { details } : {}) });
    this.name = "ProviderResponseError";
  }
}

export class AllProvidersFailedError extends BrowserSdkError {
  readonly errors: readonly BrowserSdkError[];

  constructor(errors: readonly BrowserSdkError[]) {
    super("ALL_PROVIDERS_FAILED", `Every configured browser provider failed: ${errors.map((error) => error.provider ?? "unknown").join(" -> ")}.`, {
      retryable: errors.some((error) => error.retryable),
      details: { errors: errors.map((error) => ({ code: error.code, provider: error.provider, message: error.message })) },
    });
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

export function abortedError(provider?: string, cause?: unknown): BrowserSdkError {
  return new BrowserSdkError("ABORTED", "The browser operation was cancelled.", { provider, cause });
}

export function isRetryableError(error: unknown): error is BrowserSdkError {
  if (error instanceof BrowserSdkError) return error.retryable;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof TypeError && /fetch failed|network|socket|connect|dns|timed out/i.test(error.message)) return true;
  return false;
}

export function normalizeError(error: unknown, provider?: string): BrowserSdkError {
  if (error instanceof BrowserSdkError) return error;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return abortedError(provider, error);
  if (isNetworkError(error)) {
    return new BrowserSdkError("PROVIDER_UNAVAILABLE", "The browser provider network request failed.", {
      provider,
      retryable: true,
      cause: error,
    });
  }
  return new BrowserSdkError("UNKNOWN_ERROR", "The browser operation failed unexpectedly.", { provider, cause: error });
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error instanceof TypeError && /fetch failed|network|socket|connect|dns|timed out|econnreset|enotfound/i.test(error.message);
}

export function failoverReason(error: BrowserSdkError): string {
  if (error.code === "RATE_LIMITED") return "rate_limit";
  if (error.code === "TIMEOUT") return "timeout";
  if (error.code === "AUTHENTICATION_FAILED") return "auth";
  if (error.statusCode) return String(error.statusCode);
  return error.code.toLowerCase();
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
