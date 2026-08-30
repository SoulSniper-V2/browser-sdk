import { abortedError, BrowserSdkError, RateLimitError, normalizeError, parseRetryAfter } from "./errors.js";
import type { BrowserLogger, ProviderContext } from "./types.js";

export function jsonInit(body: unknown, headers?: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export async function request(
  context: ProviderContext,
  url: string,
  init: RequestInit,
  provider: string,
): Promise<Response> {
  if (context.signal?.aborted) throw abortedError(provider, context.signal.reason);
  let response: Response;
  try {
    response = await context.fetch(url, { ...init, signal: context.signal });
  } catch (error) {
    if (context.signal?.aborted) throw abortedError(provider, context.signal.reason);
    throw normalizeError(error, provider);
  }
  if (response.ok) return response;

  const body = await safeText(response);
  const requestId = response.headers.get("cf-ray") ?? response.headers.get("x-request-id") ?? undefined;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const details = { body, requestId };
  if (response.status === 429) {
    throw new RateLimitError(`The ${provider} provider is rate limited.`, {
      provider,
      statusCode: response.status,
      retryAfterMs,
      requestId,
      details,
    });
  }
  const code = response.status === 401 ? "AUTHENTICATION_FAILED"
    : response.status === 403 ? "PERMISSION_DENIED"
      : response.status === 408 || response.status >= 500 ? "PROVIDER_UNAVAILABLE"
        : "INVALID_RESPONSE";
  throw new BrowserSdkError(code, `${provider} returned HTTP ${response.status}.`, {
    provider,
    statusCode: response.status,
    retryable: response.status === 408 || response.status >= 500,
    retryAfterMs,
    requestId,
    details,
  });
}

export async function requestJson<T>(context: ProviderContext, url: string, init: RequestInit, provider: string): Promise<T> {
  const response = await request(context, url, init, provider);
  try {
    return await response.json() as T;
  } catch (error) {
    throw new BrowserSdkError("INVALID_RESPONSE", `${provider} returned invalid JSON.`, { provider, cause: error });
  }
}

export async function requestText(context: ProviderContext, url: string, init: RequestInit, provider: string): Promise<string> {
  const response = await request(context, url, init, provider);
  return response.text();
}

export async function requestBytes(context: ProviderContext, url: string, init: RequestInit, provider: string): Promise<{ data: Uint8Array; contentType: string; headers: Headers }> {
  const response = await request(context, url, init, provider);
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    headers: response.headers,
  };
}

export function createLogger(logger?: BrowserLogger): BrowserLogger {
  return logger ?? {};
}

export function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const onAbort = () => controller.abort(a.aborted ? a.reason : b.reason);
  if (a.aborted || b.aborted) {
    onAbort();
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError(undefined, signal?.reason));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(abortedError(undefined, signal.reason));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1_000);
  } catch {
    return "";
  }
}
