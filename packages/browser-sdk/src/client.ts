import {
  AllProvidersFailedError,
  BrowserSdkError,
  CapabilityError,
  TimeoutError,
  abortedError,
  failoverReason,
  isRetryableError,
  normalizeError,
} from "./errors.js";
import { MemoryCache, stableKey } from "./cache.js";
import { createLogger, mergeSignals, sleep } from "./http.js";
import { assertHttpUrl, randomId, sourceRecord } from "./utils.js";
import type {
  BrowserCapability,
  BrowserClient,
  BrowserClientConfig,
  BrowserLogger,
  BrowserProvider,
  BrowserSession,
  BrowserSessionInfo,
  BrowserSource,
  CacheConfig,
  ContentResult,
  CrawlOptions,
  CrawlResult,
  FailoverEvent,
  FailoverHop,
  ExtractResult,
  LinksResult,
  MarkdownResult,
  PdfResult,
  ProviderContext,
  ProviderSummary,
  RenderOptions,
  RoutePreview,
  RoutingStrategy,
  ScreenshotFormat,
  ScreenshotResult,
  SessionOptions,
  SnapshotResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_BACKOFF_MS = 200;

type Operation =
  | "createSession"
  | "getSession"
  | "listSessions"
  | "closeSession"
  | "content"
  | "markdown"
  | "screenshot"
  | "pdf"
  | "snapshot"
  | "accessibilityTree"
  | "extract"
  | "links"
  | "crawl";

export class BrowserClientImpl implements BrowserClient {
  readonly timeoutMs: number;
  private readonly providerList: readonly BrowserProvider[];
  private readonly retries: number;
  private readonly strategy: RoutingStrategy;
  private readonly cache?: MemoryCache;
  private readonly fetchFn: typeof fetch;
  private readonly logger: BrowserLogger;
  private readonly onFailover?: BrowserClientConfig["onFailover"];

  constructor(config: BrowserClientConfig) {
    this.providerList = resolveProviders(config);
    if (this.providerList.length === 0) {
      throw new BrowserSdkError("INVALID_CONFIGURATION", "createBrowserClient requires at least one provider.");
    }
    this.providerList.forEach(validateProvider);
    this.timeoutMs = positiveFinite(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.retries = nonNegativeInteger(config.retries ?? DEFAULT_RETRIES, "retries");
    this.strategy = config.strategy ?? "priority";
    if (this.strategy !== "priority" && this.strategy !== "cost") {
      throw new BrowserSdkError("INVALID_CONFIGURATION", "strategy must be priority or cost.");
    }
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = createLogger(config.logger);
    this.onFailover = config.onFailover;
    if (config.cache) {
      const cacheConfig: CacheConfig = config.cache === true ? {} : config.cache;
      this.cache = new MemoryCache(cacheConfig);
    }
  }

  providers(): readonly ProviderSummary[] {
    return this.providerList.map((provider) => ({
      name: provider.name,
      capabilities: provider.capabilities,
      cost: provider.cost ?? 0,
    }));
  }

  supports(capability: BrowserCapability): boolean {
    return this.providerList.some((provider) => provider.capabilities.includes(capability));
  }

  routePreview(capability: BrowserCapability): RoutePreview {
    return {
      operation: capability,
      providers: this.candidates(capability).map((provider) => ({
        name: provider.name,
        capabilities: provider.capabilities,
        cost: providerCost(provider, capability),
      })),
    };
  }

  async createSession(options: SessionOptions = {}): Promise<BrowserSession> {
    validateSessionOptions(options);
    const info = await this.runOperation("createSession", "session", (provider, context) => {
      if (!provider.createSession) throw new CapabilityError("session", provider.name);
      return provider.createSession(options, context);
    }, options.signal);
    const provider = this.providerList.find((candidate) => candidate.name === info.provider);
    if (!provider) {
      throw new BrowserSdkError("INVALID_RESPONSE", `Provider ${info.provider} returned an unknown session owner.`, {
        provider: info.provider,
      });
    }
    return this.wrapSession(info, provider);
  }

  async getSession(providerName: string, id: string, options: { signal?: AbortSignal } = {}): Promise<BrowserSession> {
    if (!id.trim()) throw new BrowserSdkError("INVALID_OPTION", "A session id is required.");
    const provider = this.providerList.find((candidate) => candidate.name === providerName);
    if (!provider) throw new BrowserSdkError("INVALID_OPTION", `Unknown provider ${providerName}.`);
    if (!provider.getSession) throw new CapabilityError("getSession", provider.name);
    const info = await this.runPinned("getSession", provider, (context) => provider.getSession!(id, context), options.signal);
    return this.wrapSession(info, provider);
  }

  async listSessions(options: { provider?: string; status?: string; limit?: number; signal?: AbortSignal } = {}): Promise<readonly BrowserSessionInfo[]> {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BrowserSdkError("INVALID_OPTION", "Session list limit must be an integer between 1 and 500.");
    }
    if (options.provider) {
      const provider = this.providerList.find((candidate) => candidate.name === options.provider);
      if (!provider) throw new BrowserSdkError("INVALID_OPTION", `Unknown provider ${options.provider}.`);
      if (!provider.listSessions) throw new CapabilityError("listSessions", provider.name);
      return this.runPinned("listSessions", provider, (context) => provider.listSessions!({ status: options.status, limit }, context), options.signal);
    }

    const providers = this.providerList.filter((provider) => provider.listSessions);
    const settled = await Promise.allSettled(providers.map((provider) =>
      this.runPinned("listSessions", provider, (context) => provider.listSessions!({ status: options.status, limit }, context), options.signal),
    ));
    const sessions: BrowserSessionInfo[] = [];
    const errors: BrowserSdkError[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") sessions.push(...result.value);
      else errors.push(normalizeError(result.reason));
    }
    if (!sessions.length && errors.length) throw new AllProvidersFailedError(errors);
    return sessions;
  }

  async content(source: BrowserSource, options: RenderOptions = {}): Promise<ContentResult> {
    sourceRecord(source);
    const key = stableKey({ operation: "content", source, options: withoutSignal(options) });
    const hit = options.cache !== false ? this.cache?.get<ContentResult>(key) : undefined;
    if (hit) return { ...hit, cached: true };
    const result = await this.runOperation("content", "content", (provider, context) => {
      if (!provider.content) throw new CapabilityError("content", provider.name);
      return provider.content(source, options, context);
    }, options.signal);
    const clipped = clipResult(result, options.maxChars, "content");
    if (options.cache !== false) this.cache?.set(key, clipped);
    return clipped;
  }

  async markdown(source: BrowserSource, options: RenderOptions = {}): Promise<MarkdownResult> {
    sourceRecord(source);
    const key = stableKey({ operation: "markdown", source, options: withoutSignal(options) });
    const hit = options.cache !== false ? this.cache?.get<MarkdownResult>(key) : undefined;
    if (hit) return { ...hit, cached: true };
    const result = await this.runOperation("markdown", "markdown", (provider, context) => {
      if (!provider.markdown) throw new CapabilityError("markdown", provider.name);
      return provider.markdown(source, options, context);
    }, options.signal);
    const clipped = clipResult(result, options.maxChars, "markdown");
    if (options.cache !== false) this.cache?.set(key, clipped);
    return clipped;
  }

  async screenshot(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number } = {}): Promise<ScreenshotResult> {
    sourceRecord(source);
    return this.runOperation("screenshot", "screenshot", (provider, context) => {
      if (!provider.screenshot) throw new CapabilityError("screenshot", provider.name);
      return provider.screenshot(source, options, context);
    }, options.signal);
  }

  async pdf(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean } = {}): Promise<PdfResult> {
    sourceRecord(source);
    return this.runOperation("pdf", "pdf", (provider, context) => {
      if (!provider.pdf) throw new CapabilityError("pdf", provider.name);
      return provider.pdf(source, options, context);
    }, options.signal);
  }

  async snapshot(source: BrowserSource, options: RenderOptions & { formats?: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] } = {}): Promise<SnapshotResult> {
    sourceRecord(source);
    return this.runOperation("snapshot", "snapshot", (provider, context) => {
      if (!provider.snapshot) throw new CapabilityError("snapshot", provider.name);
      return provider.snapshot(source, options, context);
    }, options.signal);
  }

  async accessibilityTree(source: BrowserSource, options: RenderOptions = {}): Promise<SnapshotResult> {
    sourceRecord(source);
    return this.runOperation("accessibilityTree", "accessibility", (provider, context) => {
      if (!provider.accessibility) throw new CapabilityError("accessibilityTree", provider.name);
      return provider.accessibility(source, options, context);
    }, options.signal);
  }

  async extract<T = unknown>(source: BrowserSource, options: RenderOptions & { prompt?: string; schema?: Record<string, unknown> }): Promise<ExtractResult<T>> {
    sourceRecord(source);
    if (!options.prompt?.trim() && !options.schema) {
      throw new BrowserSdkError("INVALID_OPTION", "extract requires a prompt or JSON schema.");
    }
    return this.runOperation("extract", "extract", (provider, context) => {
      if (!provider.extract) throw new CapabilityError("extract", provider.name);
      return provider.extract<T>(source, options, context);
    }, options.signal);
  }

  async links(source: BrowserSource, options: RenderOptions & { visibleOnly?: boolean; excludeExternal?: boolean } = {}): Promise<LinksResult> {
    sourceRecord(source);
    return this.runOperation("links", "links", (provider, context) => {
      if (!provider.links) throw new CapabilityError("links", provider.name);
      return provider.links(source, options, context);
    }, options.signal);
  }

  async crawl(source: BrowserSource, options: CrawlOptions = {}): Promise<CrawlResult> {
    sourceRecord(source);
    validateCrawlOptions(options);
    const timeoutMs = Math.max(this.timeoutMs * 4, 120_000);
    return this.runOperation("crawl", "crawl", (provider, context) => {
      if (!provider.crawl) throw new CapabilityError("crawl", provider.name);
      return provider.crawl(source, options, context);
    }, options.signal, timeoutMs);
  }

  async withSession<T>(options: SessionOptions | undefined, run: (session: BrowserSession) => Promise<T>): Promise<T> {
    if (typeof run !== "function") throw new BrowserSdkError("INVALID_OPTION", "withSession requires a function.");
    const session = await this.createSession(options);
    try {
      return await run(session);
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn?.("Browser session cleanup failed.", { provider: session.provider, sessionId: session.id, error: normalizeError(error).message });
      }
    }
  }

  private candidates(capability: BrowserCapability): readonly BrowserProvider[] {
    const matching = this.providerList.filter((provider) => provider.capabilities.includes(capability));
    if (this.strategy === "cost") {
      return [...matching].sort((a, b) => providerCost(a, capability) - providerCost(b, capability));
    }
    return matching;
  }

  private async runOperation<T>(
    operation: Operation,
    capability: BrowserCapability,
    fn: (provider: BrowserProvider, context: ProviderContext) => Promise<T>,
    callerSignal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    if (callerSignal?.aborted) throw abortedError(undefined, callerSignal.reason);
    const chain = this.candidates(capability);
    if (chain.length === 0) throw new CapabilityError(operation);
    const deadlineAt = Date.now() + positiveFinite(timeoutMs, "timeoutMs");
    const errors: BrowserSdkError[] = [];
    const hops: FailoverHop[] = [];
    const requestId = randomId("req");

    for (const provider of chain) {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) {
          const timeout = new TimeoutError(provider.name, timeoutMs);
          errors.push(timeout);
          hops.push({ provider: provider.name, operation, reason: failoverReason(timeout), retryable: true });
          break;
        }
        try {
          const value = await this.runAttempt(provider, operation, fn, callerSignal, Math.max(1, remaining), requestId);
          return attachFailover(value, hops);
        } catch (error) {
          if (callerSignal?.aborted) throw abortedError(undefined, callerSignal.reason);
          const normalized = normalizeError(error, provider.name);
          errors.push(normalized);
          const retry = isRetryableError(normalized) && attempt < this.retries;
          if (retry) {
            const backoff = normalized.retryAfterMs ?? Math.min(DEFAULT_BACKOFF_MS * 2 ** attempt, 2_000);
            const delay = Math.min(backoff, Math.max(0, deadlineAt - Date.now()));
            if (delay > 0) await sleep(delay, callerSignal);
            continue;
          }
          const hop: FailoverHop = {
            provider: provider.name,
            operation,
            reason: failoverReason(normalized),
            ...(normalized.statusCode === undefined ? {} : { statusCode: normalized.statusCode }),
            retryable: normalized.retryable,
          };
          hops.push(hop);
          const next = chain[chain.indexOf(provider) + 1];
          if (next) {
            const event: FailoverEvent = { operation, from: provider.name, to: next.name, error: normalized };
            try {
              await this.onFailover?.(event);
            } catch (callbackError) {
              this.logger.warn?.("onFailover callback failed.", { error: normalizeError(callbackError).message });
            }
          }
          break;
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  private async runPinned<T>(operation: Operation, provider: BrowserProvider, fn: (context: ProviderContext) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    const errors: BrowserSdkError[] = [];
    const requestId = randomId("req");
    const deadlineAt = Date.now() + this.timeoutMs;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        errors.push(new TimeoutError(provider.name, this.timeoutMs));
        break;
      }
      try {
        return await this.runAttempt(provider, operation, (_provider, context) => fn(context), callerSignal, remaining, requestId);
      } catch (error) {
        if (callerSignal?.aborted) throw abortedError(provider.name, callerSignal.reason);
        const normalized = normalizeError(error, provider.name);
        errors.push(normalized);
        if (!isRetryableError(normalized) || attempt >= this.retries) break;
        await sleep(Math.min(normalized.retryAfterMs ?? DEFAULT_BACKOFF_MS * 2 ** attempt, Math.max(0, deadlineAt - Date.now())), callerSignal);
      }
    }
    throw new AllProvidersFailedError(errors);
  }

  private async runAttempt<T>(
    provider: BrowserProvider,
    operation: Operation,
    fn: (provider: BrowserProvider, context: ProviderContext) => Promise<T>,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
    requestId: string,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = mergeSignals(callerSignal, controller.signal);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new TimeoutError(provider.name, timeoutMs));
    }, timeoutMs);
    const context: ProviderContext = {
      fetch: this.fetchFn,
      signal,
      requestId,
      logger: this.logger,
    };
    this.logger.debug?.("Browser provider attempt started.", { operation, provider: provider.name, requestId });
    try {
      const result = await fn(provider, context);
      this.logger.debug?.("Browser provider attempt completed.", { operation, provider: provider.name, requestId });
      return result;
    } catch (error) {
      if (callerSignal?.aborted) throw abortedError(provider.name, callerSignal.reason);
      if (timedOut) throw new TimeoutError(provider.name, timeoutMs, error);
      throw normalizeError(error, provider.name);
    } finally {
      clearTimeout(timer);
    }
  }

  private wrapSession(info: BrowserSessionInfo, provider: BrowserProvider): BrowserSession {
    const client = this;
    let current = { ...info, provider: provider.name };
    let closed = false;
    const handle: BrowserSession = {
      get id() { return current.id; },
      get provider() { return current.provider; },
      get status() { return current.status; },
      get connectUrl() { return current.connectUrl; },
      get debuggerUrl() { return current.debuggerUrl; },
      get dashboardUrl() { return current.dashboardUrl; },
      get region() { return current.region; },
      get expiresAt() { return current.expiresAt; },
      get startedAt() { return current.startedAt; },
      get endedAt() { return current.endedAt; },
      get metadata() { return current.metadata; },
      get native() { return current.native; },
      get failedOverFrom() { return current.failedOverFrom; },
      async close() {
        if (closed) return;
        if (provider.closeSession) {
          await client.runPinned("closeSession", provider, (context) => provider.closeSession!(current.id, context));
        }
        closed = true;
        current = { ...current, status: "closed" };
      },
      async refresh() {
        if (!provider.getSession) return handle;
        const refreshed = await client.runPinned("getSession", provider, (context) => provider.getSession!(current.id, context));
        current = { ...refreshed, provider: provider.name };
        return handle;
      },
    };
    return handle;
  }
}

function resolveProviders(config: BrowserClientConfig): BrowserProvider[] {
  if (config.providers?.length) return [...config.providers];
  const fallbacks = Array.isArray(config.fallback) ? config.fallback : config.fallback ? [config.fallback] : [];
  return [config.provider, ...fallbacks].filter((provider): provider is BrowserProvider => Boolean(provider));
}

function validateProvider(provider: BrowserProvider): void {
  if (!provider || typeof provider !== "object") throw new BrowserSdkError("INVALID_CONFIGURATION", "Every provider must be an object.");
  if (!provider.name?.trim()) throw new BrowserSdkError("INVALID_CONFIGURATION", "Every provider must have a name.");
  if (!Array.isArray(provider.capabilities) || provider.capabilities.length === 0) {
    throw new BrowserSdkError("INVALID_CONFIGURATION", `Provider ${provider.name} must declare at least one capability.`);
  }
  for (const capability of provider.capabilities) {
    if (!(["session", "content", "markdown", "screenshot", "pdf", "snapshot", "accessibility", "extract", "links", "crawl"] as readonly string[]).includes(capability)) {
      throw new BrowserSdkError("INVALID_CONFIGURATION", `Provider ${provider.name} declares an unknown capability.`);
    }
  }
  if (provider.cost !== undefined && (!Number.isFinite(provider.cost) || provider.cost < 0)) {
    throw new BrowserSdkError("INVALID_CONFIGURATION", `Provider ${provider.name} must have a finite cost >= 0.`);
  }
}

function providerCost(provider: BrowserProvider, capability: BrowserCapability): number {
  return provider.costs?.[capability] ?? provider.cost ?? 0;
}

function validateSessionOptions(options: SessionOptions): void {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new BrowserSdkError("INVALID_OPTION", "Session timeoutMs must be a finite number > 0.");
  }
  if (options.keepAliveMs !== undefined && (!Number.isFinite(options.keepAliveMs) || options.keepAliveMs <= 0)) {
    throw new BrowserSdkError("INVALID_OPTION", "Session keepAliveMs must be a finite number > 0.");
  }
  if (options.viewport && (options.viewport.width < 1 || options.viewport.height < 1)) {
    throw new BrowserSdkError("INVALID_OPTION", "Viewport dimensions must be positive.");
  }
}

function validateCrawlOptions(options: CrawlOptions): void {
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100_000)) {
    throw new BrowserSdkError("INVALID_OPTION", "Crawl limit must be an integer between 1 and 100000.");
  }
  if (options.depth !== undefined && (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 100_000)) {
    throw new BrowserSdkError("INVALID_OPTION", "Crawl depth must be an integer between 0 and 100000.");
  }
  if (options.pollIntervalMs !== undefined && (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 0)) {
    throw new BrowserSdkError("INVALID_OPTION", "Crawl pollIntervalMs must be a finite number >= 0.");
  }
  if (options.formats && new Set(options.formats).size !== options.formats.length) {
    throw new BrowserSdkError("INVALID_OPTION", "Crawl formats must be unique.");
  }
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new BrowserSdkError("INVALID_OPTION", `${name} must be a finite number > 0.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new BrowserSdkError("INVALID_OPTION", `${name} must be an integer >= 0.`);
  return value;
}

function withoutSignal(value: RenderOptions): Omit<RenderOptions, "signal"> {
  const { signal: _signal, ...rest } = value;
  return rest;
}

function attachFailover<T>(value: T, hops: readonly FailoverHop[]): T {
  if (!hops.length || value === null || typeof value !== "object") return value;
  return { ...(value as object), failedOverFrom: hops } as T;
}

function clipResult(result: ContentResult, maxChars: number | undefined, field: "content"): ContentResult;
function clipResult(result: MarkdownResult, maxChars: number | undefined, field: "markdown"): MarkdownResult;
function clipResult(result: ContentResult | MarkdownResult, maxChars: number | undefined, field: "content" | "markdown"): ContentResult | MarkdownResult {
  const value = field === "content"
    ? (result as ContentResult).content
    : (result as MarkdownResult).markdown;
  if (maxChars === undefined) return { ...result, charCount: value.length };
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new BrowserSdkError("INVALID_OPTION", "maxChars must be an integer >= 0.");
  }
  return {
    ...result,
    [field]: value.slice(0, maxChars),
    truncated: value.length > maxChars,
    charCount: value.length,
  } as ContentResult | MarkdownResult;
}

export function createBrowserClient(config: BrowserClientConfig): BrowserClient {
  return new BrowserClientImpl(config);
}
