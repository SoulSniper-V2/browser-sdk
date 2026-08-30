import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<schemamap>
  <feed>
    <loc>${SITE_URL}/feeds/docs.jsonl</loc>
    <format>application/x-ndjson</format>
    <vocabulary>https://schema.org</vocabulary>
    <description>Browser SDK documentation as schema.org TechArticle entities.</description>
  </feed>
  <feed>
    <loc>${SITE_URL}/llms.txt</loc>
    <format>text/plain</format>
    <description>Site-level LLM index for Browser SDK.</description>
  </feed>
  <feed>
    <loc>${SITE_URL}/llms-full.txt</loc>
    <format>text/plain</format>
    <description>Combined Browser SDK documentation as Markdown.</description>
  </feed>
</schemamap>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
