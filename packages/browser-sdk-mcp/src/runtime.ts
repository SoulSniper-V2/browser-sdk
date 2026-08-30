import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { BrowserSdkError } from "@soulsniper-v2/browser-sdk";
import type { BrowserClient, BrowserSession, SessionOptions } from "@soulsniper-v2/browser-sdk";

export type BrowserSessionStartOptions = SessionOptions & { url?: string };

export interface BrowserRuntimeConfig {
  maxSessions?: number;
  allowedDomains?: readonly string[];
}

export interface BrowserActionInput {
  action: "click" | "fill" | "type" | "press" | "select" | "check" | "uncheck" | "hover" | "wait" | "scroll";
  ref?: string;
  selector?: string;
  role?: string;
  name?: string;
  value?: string;
  key?: string;
  milliseconds?: number;
  pixels?: number;
  timeoutMs?: number;
}

export interface BrowserRuntimeSession {
  sessionId: string;
  provider: string;
  status: string;
  url: string;
  title: string;
  lastUsedAt: string;
}

interface LiveSession {
  id: string;
  session: BrowserSession;
  page: Page;
  browser?: Browser;
  local: boolean;
  lastUsedAt: number;
}

interface LocalNative {
  browser: Browser;
  page: Page;
}

interface InteractiveRef {
  ref: string;
  role: string;
  name: string;
  tag: string;
}

const DEFAULT_MAX_SESSIONS = 4;

/**
 * Stateful browser control for MCP. Each tool call receives an opaque runtime
 * id; provider session ids and CDP credentials never leave this process.
 */
export class BrowserRuntime {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly maxSessions: number;
  private readonly allowedDomains?: readonly string[];

  constructor(private readonly client: BrowserClient, config: BrowserRuntimeConfig = {}) {
    this.maxSessions = integerAtLeast(config.maxSessions ?? DEFAULT_MAX_SESSIONS, 1, "maxSessions");
    this.allowedDomains = config.allowedDomains?.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  }

  async start(options: BrowserSessionStartOptions = {}): Promise<BrowserRuntimeSession> {
    if (this.sessions.size >= this.maxSessions) {
      throw new BrowserSdkError("INVALID_OPTION", `The MCP browser runtime allows at most ${this.maxSessions} active sessions.`);
    }

    const { url, ...sessionOptions } = options;
    const session = await this.client.createSession(sessionOptions);
    let live: LiveSession | undefined;
    try {
      const native = asLocalNative(session.native);
      if (native) {
        live = {
          id: runtimeId(),
          session,
          page: native.page,
          local: true,
          lastUsedAt: Date.now(),
        };
      } else {
        if (!session.connectUrl) {
          throw new BrowserSdkError("SESSION_FAILED", "The selected provider returned no CDP connection URL.", { provider: session.provider });
        }
        const browser = await chromium.connectOverCDP(session.connectUrl, {
          ...(connectHeaders(session.provider) ? { headers: connectHeaders(session.provider) } : {}),
        });
        const context = browser.contexts()[0];
        if (!context) throw new BrowserSdkError("SESSION_FAILED", "The provider returned a CDP browser with no context.", { provider: session.provider });
        const page = context.pages()[0] ?? await context.newPage();
        live = { id: runtimeId(), session, page, browser, local: false, lastUsedAt: Date.now() };
      }
      this.sessions.set(live.id, live);
      if (url) await this.navigate(live.id, url);
      return this.describe(live);
    } catch (error) {
      if (live) this.sessions.delete(live.id);
      if (live?.browser) await live.browser.close().catch(() => undefined);
      await session.close().catch(() => undefined);
      if (error instanceof BrowserSdkError) throw error;
      throw new BrowserSdkError("SESSION_FAILED", "The MCP runtime could not connect to the browser session.", { provider: session.provider, cause: error });
    }
  }

  async list(): Promise<readonly BrowserRuntimeSession[]> {
    return Promise.all([...this.sessions.values()].map((live) => this.describe(live)));
  }

  async navigate(id: string, url: string, options: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number } = {}): Promise<BrowserRuntimeSession> {
    const live = this.require(id);
    const target = assertUrl(url);
    this.assertAllowed(target);
    try {
      await live.page.goto(target.href, {
        ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      });
      this.touch(live);
      return this.describe(live);
    } catch (error) {
      throw sessionError("Browser navigation failed.", live, error);
    }
  }

  async snapshot(id: string, maxChars = 20_000): Promise<{
    sessionId: string;
    provider: string;
    url: string;
    title: string;
    snapshot: string;
    refs: readonly InteractiveRef[];
  }> {
    const live = this.require(id);
    const limit = integerAtLeast(maxChars, 500, "maxChars");
    try {
      const refs = await addInteractiveRefs(live.page);
      const aria = await live.page.locator("body").ariaSnapshot().catch(() => "");
      const text = await live.page.locator("body").innerText().catch(() => "");
      const state = await this.describe(live);
      const refLines = refs.length
        ? `Interactive refs:\n${refs.map((item) => `- ${item.role} \"${item.name}\" [ref=${item.ref}]`).join("\n")}`
        : "Interactive refs: none";
      const body = aria || text;
      return {
        sessionId: id,
        provider: state.provider,
        url: state.url,
        title: state.title,
        refs,
        snapshot: `# ${state.title || "Untitled page"}\n\nURL: ${state.url}\n\n${refLines}\n\nPage:\n${body.slice(0, limit)}`,
      };
    } catch (error) {
      throw sessionError("Browser snapshot failed.", live, error);
    }
  }

  async read(id: string, input: { ref?: string; selector?: string; maxChars?: number } = {}): Promise<{
    sessionId: string;
    provider: string;
    url: string;
    title: string;
    text: string;
  }> {
    const live = this.require(id);
    const limit = integerAtLeast(input.maxChars ?? 20_000, 1, "maxChars");
    try {
      const target = input.ref || input.selector ? this.locator(live.page, input) : live.page.locator("body");
      const text = await target.innerText();
      const state = await this.describe(live);
      this.touch(live);
      return { sessionId: id, provider: state.provider, url: state.url, title: state.title, text: text.slice(0, limit) };
    } catch (error) {
      throw sessionError("Browser read failed.", live, error);
    }
  }

  async action(id: string, input: BrowserActionInput): Promise<BrowserRuntimeSession> {
    const live = this.require(id);
    try {
      const target = input.ref || input.selector || input.role ? this.locator(live.page, input) : undefined;
      const timeout = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : undefined;
      switch (input.action) {
        case "click":
          await this.requiredTarget(target, input.action).click(timeout ? { timeout } : undefined);
          break;
        case "fill":
          await this.requiredTarget(target, input.action).fill(requiredValue(input, input.action), timeout ? { timeout } : undefined);
          break;
        case "type":
          await this.requiredTarget(target, input.action).pressSequentially(requiredValue(input, input.action), timeout ? { timeout } : undefined);
          break;
        case "press":
          await this.requiredTarget(target, input.action).press(input.key?.trim() || "Enter", timeout ? { timeout } : undefined);
          break;
        case "select":
          await this.requiredTarget(target, input.action).selectOption(requiredValue(input, input.action), timeout ? { timeout } : undefined);
          break;
        case "check":
          await this.requiredTarget(target, input.action).check(timeout ? { timeout } : undefined);
          break;
        case "uncheck":
          await this.requiredTarget(target, input.action).uncheck(timeout ? { timeout } : undefined);
          break;
        case "hover":
          await this.requiredTarget(target, input.action).hover(timeout ? { timeout } : undefined);
          break;
        case "wait":
          await live.page.waitForTimeout(clamp(input.milliseconds ?? 500, 0, 10_000));
          break;
        case "scroll":
          if (target) await target.scrollIntoViewIfNeeded(timeout ? { timeout } : undefined);
          else await live.page.evaluate((pixels) => window.scrollBy(0, pixels), input.pixels ?? 600);
          break;
      }
      this.touch(live);
      return this.describe(live);
    } catch (error) {
      throw sessionError(`Browser ${input.action} failed.`, live, error);
    }
  }

  async screenshot(id: string, input: { ref?: string; selector?: string; fullPage?: boolean; format?: "png" | "jpeg"; quality?: number } = {}): Promise<{ data: Uint8Array; mimeType: string; format: "png" | "jpeg" }> {
    const live = this.require(id);
    try {
      const type = input.format ?? "png";
      const target = input.ref || input.selector ? this.locator(live.page, input) : undefined;
      const data = target
        ? await target.screenshot({ type, ...(input.quality === undefined ? {} : { quality: input.quality }) })
        : await live.page.screenshot({ type, ...(input.fullPage === undefined ? {} : { fullPage: input.fullPage }), ...(input.quality === undefined ? {} : { quality: input.quality }) });
      this.touch(live);
      return { data, mimeType: type === "jpeg" ? "image/jpeg" : "image/png", format: type };
    } catch (error) {
      throw sessionError("Browser screenshot failed.", live, error);
    }
  }

  async close(id: string): Promise<{ sessionId: string; closed: true }> {
    const live = this.require(id);
    this.sessions.delete(id);
    try {
      if (live.browser) await live.browser.close();
    } finally {
      await live.session.close().catch(() => undefined);
    }
    return { sessionId: id, closed: true };
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.close(id)));
  }

  private locator(page: Page, input: Pick<BrowserActionInput, "ref" | "selector" | "role" | "name">): Locator {
    if (input.ref) {
      if (!/^e\d+$/.test(input.ref)) throw new BrowserSdkError("INVALID_OPTION", "Snapshot refs must look like e1, e2, and so on.");
      return page.locator(`[data-browser-sdk-ref="${input.ref}"]`);
    }
    if (input.selector) return page.locator(input.selector);
    if (input.role) return page.getByRole(input.role as Parameters<Page["getByRole"]>[0], input.name ? { name: input.name } : undefined);
    throw new BrowserSdkError("INVALID_OPTION", "Provide a snapshot ref, CSS selector, or ARIA role.");
  }

  private requiredTarget(target: Locator | undefined, action: string): Locator {
    if (!target) throw new BrowserSdkError("INVALID_OPTION", `${action} requires ref, selector, or role.`);
    return target;
  }

  private require(id: string): LiveSession {
    const live = this.sessions.get(id);
    if (!live) throw new BrowserSdkError("SESSION_FAILED", `MCP browser session ${id} is not active.`);
    return live;
  }

  private async describe(live: LiveSession): Promise<BrowserRuntimeSession> {
    return {
      sessionId: live.id,
      provider: live.session.provider,
      status: live.session.status,
      url: live.page.url(),
      title: await live.page.title().catch(() => ""),
      lastUsedAt: new Date(live.lastUsedAt).toISOString(),
    };
  }

  private touch(live: LiveSession): void {
    live.lastUsedAt = Date.now();
  }

  private assertAllowed(url: URL): void {
    if (!this.allowedDomains?.length) return;
    const hostname = url.hostname.toLowerCase();
    const allowed = this.allowedDomains.some((domain) => {
      const normalized = domain.replace(/^\*\./, "");
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
    if (!allowed) throw new BrowserSdkError("PERMISSION_DENIED", `Navigation to ${hostname} is outside the MCP browser allowlist.`);
  }
}

async function addInteractiveRefs(page: Page): Promise<InteractiveRef[]> {
  return page.evaluate(() => {
    document.querySelectorAll("[data-browser-sdk-ref]").forEach((element) => element.removeAttribute("data-browser-sdk-ref"));
    const selector = "a,button,input,textarea,select,[role],[contenteditable=\"true\"]";
    const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && !element.hasAttribute("disabled");
    }).slice(0, 80);
    return elements.map((element, index) => {
      const ref = `e${index + 1}`;
      element.setAttribute("data-browser-sdk-ref", ref);
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute("type");
      const role = element.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : tag === "textarea" ? "textbox" : tag === "select" ? "combobox" : tag === "input" && (type === "checkbox" || type === "radio") ? type : tag === "input" ? "textbox" : tag);
      const name = (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name") || (element instanceof HTMLInputElement ? element.value : "") || element.textContent || tag).replace(/\s+/g, " ").trim().slice(0, 120);
      return { ref, role, name: name || tag, tag };
    });
  });
}

function asLocalNative(value: unknown): LocalNative | undefined {
  if (!value || typeof value !== "object") return undefined;
  const native = value as Partial<LocalNative>;
  return native.browser && native.page ? native as LocalNative : undefined;
}

function connectHeaders(provider: string): Record<string, string> | undefined {
  if (provider !== "cloudflare-browser-run") return undefined;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function assertUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new BrowserSdkError("INVALID_SOURCE", "Browser navigation requires an absolute http(s) URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BrowserSdkError("INVALID_SOURCE", "Browser navigation requires an http(s) URL.");
  return url;
}

function runtimeId(): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `mcp_${uuid}`;
}

function sessionError(message: string, live: LiveSession, cause: unknown): BrowserSdkError {
  if (cause instanceof BrowserSdkError) return cause;
  return new BrowserSdkError("SESSION_FAILED", message, { provider: live.session.provider, cause });
}

function requiredValue(input: BrowserActionInput, action: string): string {
  if (typeof input.value !== "string") throw new BrowserSdkError("INVALID_OPTION", `${action} requires value.`);
  return input.value;
}

function integerAtLeast(value: number, minimum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum) throw new BrowserSdkError("INVALID_OPTION", `${name} must be an integer >= ${minimum}.`);
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
