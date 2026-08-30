export const BROWSER_CAPABILITIES = [
  "session",
  "content",
  "markdown",
  "screenshot",
  "pdf",
  "snapshot",
  "accessibility",
  "extract",
  "links",
  "crawl",
] as const;

export type BrowserCapability = (typeof BROWSER_CAPABILITIES)[number];
export type RoutingStrategy = "priority" | "cost";
export type ProviderSessionStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "closed";

export interface BrowserLogger {
  debug?(message: string, details?: Record<string, unknown>): void;
  info?(message: string, details?: Record<string, unknown>): void;
  warn?(message: string, details?: Record<string, unknown>): void;
  error?(message: string, details?: Record<string, unknown>): void;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface GotoOptions {
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  timeout?: number;
}

export interface ScriptTag {
  url?: string;
  content?: string;
}

export interface StyleTag {
  url?: string;
  content?: string;
}

export interface RenderOptions {
  proxy?: boolean | Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: readonly BrowserCookie[];
  userAgent?: string;
  viewport?: Viewport;
  gotoOptions?: GotoOptions;
  waitForSelector?: string;
  waitForTimeout?: number;
  addScriptTag?: readonly ScriptTag[];
  addStyleTag?: readonly StyleTag[];
  setExtraHTTPHeaders?: Record<string, string>;
  authenticate?: { username: string; password: string };
  /** Clip text artifacts after the provider returns them. Useful for model context. */
  maxChars?: number;
  cache?: boolean;
  signal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
}

export type BrowserSource = string | { url: string } | { html: string };

export interface SessionOptions {
  projectId?: string;
  contextId?: string;
  profileId?: string;
  region?: string;
  timeoutMs?: number;
  keepAlive?: boolean;
  keepAliveMs?: number;
  proxy?: boolean | Record<string, unknown>;
  viewport?: Viewport;
  userAgent?: string;
  recording?: boolean;
  logSession?: boolean;
  stealth?: boolean;
  solveCaptchas?: boolean;
  allowedDomains?: readonly string[];
  metadata?: Record<string, unknown>;
  executablePath?: string;
  headless?: boolean;
  signal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
}

export interface FailoverHop {
  provider: string;
  operation: string;
  reason: string;
  statusCode?: number;
  retryable: boolean;
}

export interface UsageMetadata {
  browserMsUsed?: number;
  requestId?: string;
  [key: string]: unknown;
}

export interface ResultBase {
  source: BrowserSource;
  provider: string;
  latencyMs: number;
  statusCode?: number;
  usage?: UsageMetadata;
  cached?: boolean;
  failedOverFrom?: readonly FailoverHop[];
  truncated?: boolean;
  charCount?: number;
}

export interface ContentResult extends ResultBase {
  content: string;
  contentType?: string;
  title?: string;
  finalUrl?: string;
}

export interface MarkdownResult extends ResultBase {
  markdown: string;
  title?: string;
  finalUrl?: string;
}

export type ScreenshotFormat = "png" | "jpeg" | "webp";

export interface ScreenshotResult extends ResultBase {
  data: Uint8Array;
  contentType: string;
  format: ScreenshotFormat;
}

export interface PdfResult extends ResultBase {
  data: Uint8Array;
  contentType: "application/pdf";
}

export interface SnapshotResult extends ResultBase {
  content?: string;
  markdown?: string;
  screenshot?: Uint8Array;
  accessibilityTree?: unknown;
}

export interface ExtractResult<T = unknown> extends ResultBase {
  data: T;
  prompt?: string;
}

export interface LinksResult extends ResultBase {
  links: readonly string[];
}

export interface CrawlRecord {
  url: string;
  status: string;
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface CrawlResult extends ResultBase {
  jobId?: string;
  status: "queued" | "running" | "completed" | "failed";
  records: readonly CrawlRecord[];
  total?: number;
  finished?: number;
  cursor?: number;
}

export interface CrawlOptions extends RenderOptions {
  limit?: number;
  depth?: number;
  formats?: readonly ("html" | "markdown" | "json")[];
  includePatterns?: readonly string[];
  excludePatterns?: readonly string[];
  crawlPurposes?: readonly ("search" | "ai-input" | "ai-train")[];
  pollIntervalMs?: number;
}

export interface BrowserSessionInfo {
  id: string;
  provider: string;
  status: ProviderSessionStatus;
  connectUrl?: string;
  debuggerUrl?: string;
  dashboardUrl?: string;
  region?: string;
  expiresAt?: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
  native?: unknown;
  failedOverFrom?: readonly FailoverHop[];
}

export interface BrowserSession extends BrowserSessionInfo {
  close(): Promise<void>;
  refresh(): Promise<BrowserSession>;
}

export interface ProviderContext {
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
  readonly requestId: string;
  readonly logger: BrowserLogger;
}

export interface BrowserProvider {
  readonly name: string;
  readonly capabilities: readonly BrowserCapability[];
  readonly cost?: number;
  readonly costs?: Partial<Record<BrowserCapability, number>>;
  createSession?(options: SessionOptions, context: ProviderContext): Promise<BrowserSessionInfo>;
  getSession?(id: string, context: ProviderContext): Promise<BrowserSessionInfo>;
  listSessions?(options: { status?: string; limit?: number }, context: ProviderContext): Promise<readonly BrowserSessionInfo[]>;
  closeSession?(id: string, context: ProviderContext): Promise<void>;
  content?(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult>;
  markdown?(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<MarkdownResult>;
  screenshot?(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }, context: ProviderContext): Promise<ScreenshotResult>;
  pdf?(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean }, context: ProviderContext): Promise<PdfResult>;
  snapshot?(source: BrowserSource, options: RenderOptions & { formats?: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] }, context: ProviderContext): Promise<SnapshotResult>;
  accessibility?(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<SnapshotResult>;
  extract?<T = unknown>(source: BrowserSource, options: RenderOptions & { prompt?: string; schema?: Record<string, unknown> }, context: ProviderContext): Promise<ExtractResult<T>>;
  links?(source: BrowserSource, options: RenderOptions & { visibleOnly?: boolean; excludeExternal?: boolean }, context: ProviderContext): Promise<LinksResult>;
  crawl?(source: BrowserSource, options: CrawlOptions, context: ProviderContext): Promise<CrawlResult>;
}

export interface CacheConfig {
  ttlMs?: number;
  maxEntries?: number;
}

export interface FailoverEvent {
  operation: string;
  from: string;
  to?: string;
  error: BrowserSdkErrorLike;
}

export interface BrowserSdkErrorLike {
  name: string;
  message: string;
  code?: string;
  provider?: string;
  statusCode?: number;
  retryable?: boolean;
}

export interface BrowserClientConfig {
  providers?: readonly BrowserProvider[];
  provider?: BrowserProvider;
  fallback?: BrowserProvider | readonly BrowserProvider[];
  timeoutMs?: number;
  retries?: number;
  strategy?: RoutingStrategy;
  cache?: boolean | CacheConfig;
  fetch?: typeof fetch;
  logger?: BrowserLogger;
  onFailover?: (event: FailoverEvent) => void | Promise<void>;
}

export interface ProviderSummary {
  name: string;
  capabilities: readonly BrowserCapability[];
  cost: number;
}

export interface RoutePreview {
  operation: string;
  providers: readonly ProviderSummary[];
}

export interface BrowserClient {
  readonly timeoutMs: number;
  providers(): readonly ProviderSummary[];
  supports(capability: BrowserCapability): boolean;
  routePreview(capability: BrowserCapability): RoutePreview;
  createSession(options?: SessionOptions): Promise<BrowserSession>;
  getSession(provider: string, id: string, options?: { signal?: AbortSignal }): Promise<BrowserSession>;
  listSessions(options?: { provider?: string; status?: string; limit?: number; signal?: AbortSignal }): Promise<readonly BrowserSessionInfo[]>;
  content(source: BrowserSource, options?: RenderOptions): Promise<ContentResult>;
  markdown(source: BrowserSource, options?: RenderOptions): Promise<MarkdownResult>;
  screenshot(source: BrowserSource, options?: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }): Promise<ScreenshotResult>;
  pdf(source: BrowserSource, options?: RenderOptions & { landscape?: boolean; printBackground?: boolean }): Promise<PdfResult>;
  snapshot(source: BrowserSource, options?: RenderOptions & { formats?: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] }): Promise<SnapshotResult>;
  accessibilityTree(source: BrowserSource, options?: RenderOptions): Promise<SnapshotResult>;
  extract<T = unknown>(source: BrowserSource, options: RenderOptions & { prompt?: string; schema?: Record<string, unknown> }): Promise<ExtractResult<T>>;
  links(source: BrowserSource, options?: RenderOptions & { visibleOnly?: boolean; excludeExternal?: boolean }): Promise<LinksResult>;
  crawl(source: BrowserSource, options?: CrawlOptions): Promise<CrawlResult>;
  withSession<T>(options: SessionOptions | undefined, run: (session: BrowserSession) => Promise<T>): Promise<T>;
}
