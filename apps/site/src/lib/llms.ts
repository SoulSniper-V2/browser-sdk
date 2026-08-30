import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { source } from "@/lib/source";
import { SITE_URL, markdownUrl } from "@/lib/site";

export type DocumentationPage = ReturnType<typeof source.getPages>[number];

export function docsIndexLines() {
  return source.getPages().map((page) => {
    const description = page.data.description ? `: ${page.data.description}` : "";
    return `- [${page.data.title}](${page.url})${description}`;
  }).join("\n");
}

export async function pageMarkdown(page: DocumentationPage) {
  const data = page.data as { getText?: (kind: "processed" | "raw") => Promise<string> };
  if (typeof data.getText === "function") {
    try {
      return await data.getText("processed");
    } catch {
      // Fall through to the canonical Markdown file.
    }
  }

  const relative = page.slugs.length ? `${page.slugs.join("/")}.md` : "index.md";
  const raw = await readFile(join(process.cwd(), "../../docs", relative), "utf8");
  return raw.replace(/^---[\r\n]+[\s\S]*?---[\r\n]*/, "").trim();
}

export async function llmPage(page: DocumentationPage) {
  const canonical = `${SITE_URL}${page.url}`;
  return `# ${page.data.title} (${canonical})\n\nCanonical: ${canonical}\nMarkdown: ${SITE_URL}${markdownUrl(page.url)}\n\n${await pageMarkdown(page)}`.trim();
}
