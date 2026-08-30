import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { getMDXComponents } from "@/components/mdx";
import { PageMarkdownActions } from "@/components/PageMarkdownActions";
import { source } from "@/lib/source";

function markdownUrl(slugs: readonly string[]) {
  return slugs.length === 0 ? "/docs.md" : `/docs/${slugs.join("/")}.md`;
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <PageMarkdownActions markdownUrl={markdownUrl(params.slug ?? [])} />
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
