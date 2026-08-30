import { BrowserSdkError, ProviderResponseError, UnsupportedOptionError } from "../errors.js";
import { requestText } from "../http.js";
import { extractLinks, firstHeading, htmlTitle, htmlToMarkdown, randomId, sourceRecord } from "../utils.js";
import type {
  BrowserCookie,
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  GotoOptions,
  LinksResult,
  MarkdownResult,
  PdfResult,
  ProviderContext,
  RenderOptions,
  ScreenshotFormat,
  ScreenshotResult,
  SessionOptions,
  SnapshotResult,
} from "../types.js";

export interface LocalConfig {
  executablePath?: string;
  userAgent?: string;
}

type LocalPage = {
  goto(url: string, options?: unknown): Promise<unknown>;
  setContent(html: string, options?: unknown): Promise<unknown>;
  content(): Promise<string>;
  title(): Promise<string>;
  screenshot(options?: Record<string, unknown>): Promise<Uint8Array>;
  pdf(options?: Record<string, unknown>): Promise<Uint8Array>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  addScriptTag(options: Record<string, unknown>): Promise<unknown>;
  addStyleTag(options: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  locator(selector: string): { screenshot(options?: Record<string, unknown>): Promise<Uint8Array> };
  accessibility?: { snapshot(): Promise<unknown> };
};

type LocalContext = {
  newPage(): Promise<LocalPage>;
  addCookies(cookies: readonly unknown[]): Promise<void>;
  close(): Promise<void>;
};

type LocalBrowser = {
  newContext(options?: Record<string, unknown>): Promise<LocalContext>;
  close(): Promise<void>;
};

type LocalSession = {
  browser: LocalBrowser;
  context: LocalContext;
  page: LocalPage;
  metadata?: Record<string, unknown>;
  expiration?: ReturnType<typeof setTimeout>;
};

const PROVIDER = "local";

export function local(config: LocalConfig = {}): BrowserProvider {
  const active = new Map<string, LocalSession>();
  return {
    name: PROVIDER,
    capabilities: ["session", "content", "markdown", "screenshot", "pdf", "snapshot", "accessibility", "links"],
    cost: 0,
    async createSession(options: SessionOptions): Promise<BrowserSessionInfo> {
      assertLocalSessionOptions(options);
      const browser = await launchBrowser(config, options);
      try {
        const context = await browser.newContext({
          ...(options.viewport ? { viewport: options.viewport } : {}),
          ...((options.userAgent ?? config.userAgent) ? { userAgent: options.userAgent ?? config.userAgent! } : {}),
        });
        const page = await context.newPage();
        const id = randomId("local");
        const session: LocalSession = { browser, context, page, ...(options.metadata ? { metadata: options.metadata } : {}) };
        active.set(id, session);
        if (options.timeoutMs !== undefined) {
          session.expiration = setTimeout(() => {
            if (active.get(id) !== session) return;
            active.delete(id);
            void browser.close();
          }, options.timeoutMs);
        }
        return {
          id,
          provider: PROVIDER,
          status: "ready",
          native: { browser, context, page },
          ...(options.metadata ? { metadata: options.metadata } : {}),
        };
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }
    },
    async getSession(id: string): Promise<BrowserSessionInfo> {
      const session = active.get(id);
      if (!session) throw new BrowserSdkError("SESSION_FAILED", `Local session ${id} is not active.`, { provider: PROVIDER });
      return { id, provider: PROVIDER, status: "running", native: { browser: session.browser, context: session.context, page: session.page }, ...(session.metadata ? { metadata: session.metadata } : {}) };
    },
    async listSessions(options): Promise<readonly BrowserSessionInfo[]> {
      if (options.status && !["pending", "ready", "running"].includes(options.status.toLowerCase())) return [];
      return [...active.entries()].slice(0, options.limit ?? 50).map(([id, session]) => ({
        id,
        provider: PROVIDER,
        status: "running" as const,
        ...(session.metadata ? { metadata: session.metadata } : {}),
      }));
    },
    async closeSession(id: string): Promise<void> {
      const session = active.get(id);
      if (!session) return;
      active.delete(id);
      if (session.expiration) clearTimeout(session.expiration);
      await session.browser.close();
    },
    async content(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<ContentResult> {
      assertLocalFetchOptions(options);
      const startedAt = Date.now();
      const input = sourceRecord(source);
      let html: string;
      let finalUrl: string | undefined;
      let statusCode: number | undefined;
      if (input.html) {
        html = input.html;
      } else {
        const response = await requestText(context, input.url!, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            ...((options.userAgent ?? config.userAgent) ? { "User-Agent": options.userAgent ?? config.userAgent! } : {}),
            ...(options.cookies?.length ? { Cookie: serializeCookies(options.cookies) } : {}),
            ...(options.headers ?? {}),
            ...(options.setExtraHTTPHeaders ?? {}),
          },
        }, PROVIDER);
        html = response;
        finalUrl = input.url;
        statusCode = 200;
      }
      return {
        source,
        provider: PROVIDER,
        latencyMs: Date.now() - startedAt,
        content: html,
        ...(htmlTitle(html) || firstHeading(html) ? { title: htmlTitle(html) ?? firstHeading(html) } : {}),
        ...(finalUrl ? { finalUrl } : {}),
        ...(statusCode === undefined ? {} : { statusCode }),
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
        ...(content.finalUrl ? { finalUrl: content.finalUrl } : {}),
      };
    },
    async screenshot(source: BrowserSource, options: RenderOptions & { format?: ScreenshotFormat; fullPage?: boolean; selector?: string; quality?: number }): Promise<ScreenshotResult> {
      assertLocalOptions(options);
      const startedAt = Date.now();
      const browser = await launchBrowser(config, options);
      try {
        const context = await browser.newContext({
          ...(options.viewport ? { viewport: options.viewport } : {}),
          ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          ...(options.authenticate ? { httpCredentials: options.authenticate } : {}),
        });
        const page = await preparePage(context, source, options);
        const format = options.format ?? "png";
        const data = options.selector
          ? await page.locator(options.selector).screenshot({ type: format, ...(options.quality === undefined ? {} : { quality: options.quality }) })
          : await page.screenshot({ type: format, ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }), ...(options.quality === undefined ? {} : { quality: options.quality }) });
        await context.close();
        await browser.close();
        return {
          source,
          provider: PROVIDER,
          latencyMs: Date.now() - startedAt,
          data,
          contentType: format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png",
          format,
        };
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }
    },
    async pdf(source: BrowserSource, options: RenderOptions & { landscape?: boolean; printBackground?: boolean }): Promise<PdfResult> {
      assertLocalOptions(options);
      const startedAt = Date.now();
      const browser = await launchBrowser(config, options);
      try {
        const context = await browser.newContext({
          ...(options.viewport ? { viewport: options.viewport } : {}),
          ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          ...(options.authenticate ? { httpCredentials: options.authenticate } : {}),
        });
        const page = await preparePage(context, source, options);
        const data = await page.pdf({
          ...(options.landscape === undefined ? {} : { landscape: options.landscape }),
          ...(options.printBackground === undefined ? {} : { printBackground: options.printBackground }),
        });
        await context.close();
        await browser.close();
        return { source, provider: PROVIDER, latencyMs: Date.now() - startedAt, data, contentType: "application/pdf" };
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }
    },
    async snapshot(source: BrowserSource, options: RenderOptions & { formats?: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] }): Promise<SnapshotResult> {
      assertLocalOptions(options);
      const startedAt = Date.now();
      const browser = await launchBrowser(config, options);
      try {
        const context = await browser.newContext({
          ...(options.viewport ? { viewport: options.viewport } : {}),
          ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          ...(options.authenticate ? { httpCredentials: options.authenticate } : {}),
        });
        const page = await preparePage(context, source, options);
        const content = await page.content();
        const formats = validateSnapshotFormats(options.formats ?? ["content", "screenshot"]);
        const result: SnapshotResult = {
          source,
          provider: PROVIDER,
          latencyMs: Date.now() - startedAt,
          ...(formats.includes("content") ? { content } : {}),
          ...(formats.includes("markdown") ? { markdown: htmlToMarkdown(content) } : {}),
          ...(formats.includes("screenshot") ? { screenshot: await page.screenshot({ type: "png", fullPage: true }) } : {}),
          ...(formats.includes("accessibilityTree") && page.accessibility ? { accessibilityTree: await page.accessibility.snapshot() } : {}),
        };
        await context.close();
        await browser.close();
        return result;
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }
    },
    async accessibility(source: BrowserSource, options: RenderOptions, context: ProviderContext): Promise<SnapshotResult> {
      const snapshot = await this.snapshot!(source, { ...options, formats: ["accessibilityTree"] }, context);
      return snapshot;
    },
    async links(source: BrowserSource, options: RenderOptions & { visibleOnly?: boolean; excludeExternal?: boolean }, context: ProviderContext): Promise<LinksResult> {
      if (options.visibleOnly) throw new UnsupportedOptionError("visibleOnly", PROVIDER);
      const input = sourceRecord(source);
      if (options.excludeExternal && !input.url) throw new UnsupportedOptionError("excludeExternal for inline HTML", PROVIDER);
      const content = await this.content!(source, options, context);
      let links = extractLinks(content.content, input.url);
      if (options.excludeExternal && input.url) {
        const origin = new URL(input.url).origin;
        links = links.filter((link) => {
          try { return new URL(link).origin === origin; } catch { return false; }
        });
      }
      return { source, provider: PROVIDER, latencyMs: content.latencyMs, links };
    },
  };
}

async function launchBrowser(config: LocalConfig, options: SessionOptions | RenderOptions): Promise<LocalBrowser> {
  try {
    const module = await import("playwright-core");
    const executablePath = "executablePath" in options ? options.executablePath : config.executablePath;
    return await module.chromium.launch({
      headless: "headless" in options ? options.headless ?? true : true,
      ...(executablePath ? { executablePath } : {}),
    }) as unknown as LocalBrowser;
  } catch (error) {
    if (error instanceof BrowserSdkError) throw error;
    throw new BrowserSdkError("DEPENDENCY_MISSING", "The local provider needs playwright-core and a Chromium executable. Install playwright or pass executablePath.", {
      provider: PROVIDER,
      cause: error,
    });
  }
}

async function preparePage(context: LocalContext, source: BrowserSource, options: RenderOptions): Promise<LocalPage> {
  assertLocalOptions(options);
  if (options.cookies) await context.addCookies(options.cookies);
  const page = await context.newPage();
  const headers = { ...(options.headers ?? {}), ...(options.setExtraHTTPHeaders ?? {}) };
  if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);
  const input = sourceRecord(source);
  const gotoOptions = toPlaywrightGotoOptions(options.gotoOptions);
  if (input.url) await page.goto(input.url, gotoOptions);
  else await page.setContent(input.html!, gotoOptions);
  if (options.waitForSelector) await page.waitForSelector(options.waitForSelector);
  if (options.waitForTimeout !== undefined) await page.waitForTimeout(options.waitForTimeout);
  for (const script of options.addScriptTag ?? []) await page.addScriptTag(script as Record<string, unknown>);
  for (const style of options.addStyleTag ?? []) await page.addStyleTag(style as Record<string, unknown>);
  return page;
}

function assertLocalOptions(options: RenderOptions): void {
  if (options.proxy) throw new UnsupportedOptionError("proxy", PROVIDER);
  if (options.providerOptions && Object.keys(options.providerOptions).length) {
    throw new UnsupportedOptionError("providerOptions", PROVIDER);
  }
}

function assertLocalFetchOptions(options: RenderOptions): void {
  if (options.proxy) throw new UnsupportedOptionError("proxy", PROVIDER);
  if (options.viewport) throw new UnsupportedOptionError("viewport", PROVIDER);
  if (options.gotoOptions) throw new UnsupportedOptionError("gotoOptions", PROVIDER);
  if (options.waitForSelector) throw new UnsupportedOptionError("waitForSelector", PROVIDER);
  if (options.waitForTimeout !== undefined) throw new UnsupportedOptionError("waitForTimeout", PROVIDER);
  if (options.addScriptTag) throw new UnsupportedOptionError("addScriptTag", PROVIDER);
  if (options.addStyleTag) throw new UnsupportedOptionError("addStyleTag", PROVIDER);
  if (options.authenticate) throw new UnsupportedOptionError("authenticate", PROVIDER);
  if (options.providerOptions && Object.keys(options.providerOptions).length) {
    throw new UnsupportedOptionError("providerOptions", PROVIDER);
  }
}

function assertLocalSessionOptions(options: SessionOptions): void {
  if (options.proxy) throw new UnsupportedOptionError("proxy", PROVIDER);
  if (options.contextId) throw new UnsupportedOptionError("contextId", PROVIDER);
  if (options.profileId) throw new UnsupportedOptionError("profileId", PROVIDER);
  if (options.region) throw new UnsupportedOptionError("region", PROVIDER);
  if (options.keepAlive !== undefined) throw new UnsupportedOptionError("keepAlive", PROVIDER);
  if (options.keepAliveMs !== undefined) throw new UnsupportedOptionError("keepAliveMs", PROVIDER);
  if (options.recording !== undefined) throw new UnsupportedOptionError("recording", PROVIDER);
  if (options.logSession !== undefined) throw new UnsupportedOptionError("logSession", PROVIDER);
  if (options.stealth !== undefined) throw new UnsupportedOptionError("stealth", PROVIDER);
  if (options.solveCaptchas !== undefined) throw new UnsupportedOptionError("solveCaptchas", PROVIDER);
  if (options.allowedDomains) throw new UnsupportedOptionError("allowedDomains", PROVIDER);
  if (options.providerOptions && Object.keys(options.providerOptions).length) {
    throw new UnsupportedOptionError("providerOptions", PROVIDER);
  }
}

function validateSnapshotFormats(formats: readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[]): readonly ("content" | "markdown" | "screenshot" | "accessibilityTree")[] {
  if (!formats.length) throw new BrowserSdkError("INVALID_OPTION", "Snapshot formats cannot be empty.", { provider: PROVIDER });
  if (new Set(formats).size !== formats.length) throw new BrowserSdkError("INVALID_OPTION", "Snapshot formats must be unique.", { provider: PROVIDER });
  return formats;
}

function toPlaywrightGotoOptions(options: GotoOptions | undefined): Record<string, unknown> | undefined {
  if (!options) return undefined;
  return {
    ...(options.waitUntil ? { waitUntil: options.waitUntil === "networkidle0" || options.waitUntil === "networkidle2" ? "networkidle" : options.waitUntil } : {}),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  };
}

function serializeCookies(cookies: readonly BrowserCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
