import { llmPage } from "@/lib/llms";
import { source } from "@/lib/source";
import { TEXT_HEADERS } from "@/lib/site";

export const dynamic = "force-static";

export async function GET() {
  const pages = await Promise.all(source.getPages().map(llmPage));
  return new Response(pages.join("\n\n---\n\n"), { headers: TEXT_HEADERS });
}
