import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { BrowserLogo } from "@/components/BrowserLogo";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fumadocs-docs-shell">
      <DocsLayout
        tree={source.getPageTree()}
        nav={{
          title: (
            <span className="fumadocs-brand">
              <BrowserLogo className="fumadocs-brand-mark" size={27} />
              <span>Browser SDK</span>
            </span>
          ),
          url: "/",
        }}
        sidebar={{ defaultOpenLevel: 2 }}
      >
        {children}
      </DocsLayout>
    </div>
  );
}
