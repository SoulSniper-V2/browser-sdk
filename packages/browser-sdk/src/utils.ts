import { BrowserSdkError } from "./errors.js";
import type { BrowserSource, BrowserLogger, BrowserCookie, ScriptTag, StyleTag } from "./types.js";

export function sourceRecord(source: BrowserSource): { url?: string; html?: string } {
  if (typeof source === "string") {
    assertHttpUrl(source);
    return { url: source };
  }
  if ("url" in source) {
    assertHttpUrl(source.url);
    return { url: source.url };
  }
  if (typeof source.html !== "string" || source.html.length === 0) {
    throw new BrowserSdkError("INVALID_SOURCE", "An HTML source must contain non-empty html.");
  }
  return { html: source.html };
}

export function sourceLabel(source: BrowserSource): string {
  if (typeof source === "string" || "url" in source) return sourceRecord(source).url!;
  sourceRecord(source);
  return "inline-html";
}

export function assertHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserSdkError("INVALID_SOURCE", `Invalid browser URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserSdkError("INVALID_SOURCE", "Browser sources must use http or https.");
  }
}

export function randomId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
}

export function firstHeading(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

export function htmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}

export function extractLinks(html: string, baseUrl?: string): string[] {
  const links: string[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // Ignore malformed links from a page.
    }
  }
  return [...new Set(links)];
}

export function normalizeProviderOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
  return options ? { ...options } : {};
}

export function jsonSafeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  return { ...headers };
}

export type Cookie = BrowserCookie;
export type Script = ScriptTag;
export type Style = StyleTag;

export function loggerOrSilent(logger?: BrowserLogger): BrowserLogger {
  return logger ?? {};
}
