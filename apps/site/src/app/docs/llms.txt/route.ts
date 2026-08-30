import { docsIndexLines } from "@/lib/llms";
import { TEXT_HEADERS } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  return new Response(`# Browser SDK documentation\n\n> Scoped documentation index. Use /llms.txt for the product index or /llms-full.txt for the complete corpus.\n\n${docsIndexLines()}\n`, { headers: TEXT_HEADERS });
}
