import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const publicDir = join(root, "apps/site/public");
const publicDocsDir = join(publicDir, "docs");

await mkdir(publicDocsDir, { recursive: true });
await mkdir(join(publicDir, "skills/browser-sdk"), { recursive: true });

const files = (await readdir(docsDir)).filter((file) => file.endsWith(".md")).sort();
const pages = await Promise.all(files.map(async (file) => {
  const markdown = await readFile(join(docsDir, file), "utf8");
  const title = markdown.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
  const description = markdown.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const slug = file === "index.md" ? "" : file.replace(/\.md$/, "");
  const url = slug ? `/docs/${slug}` : "/docs";
  const rawUrl = slug ? `/docs/${slug}.md` : "/docs.md";
  const body = markdown.replace(/^---[\r\n]+[\s\S]*?---[\r\n]*/, "").trim();
  await cp(join(docsDir, file), join(publicDocsDir, file));
  return { file, title, description, slug, url, rawUrl, body };
}));

await cp(join(root, "skills/browser-sdk/mcp.json"), join(publicDir, "skills/browser-sdk/mcp.json"));

const indexLines = pages.map((page) => `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`).join("\n");
console.log(`Synced ${pages.length} docs pages into ${relative(root, publicDocsDir)}.`);
