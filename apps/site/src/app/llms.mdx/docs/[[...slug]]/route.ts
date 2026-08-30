import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export const dynamic = "force-static";

function docPath(slug?: string[]) {
  const parts = slug?.length ? slug : ["index"];
  const relative = `${parts.join("/")}.md`;
  const root = normalize(join(process.cwd(), "../../docs"));
  const candidate = normalize(join(root, relative));
  if (!candidate.startsWith(`${root}/`)) throw new Error("Invalid documentation path");
  return candidate;
}

export async function GET(_request: Request, context: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await context.params;
  try {
    const markdown = await readFile(docPath(slug), "utf8");
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
