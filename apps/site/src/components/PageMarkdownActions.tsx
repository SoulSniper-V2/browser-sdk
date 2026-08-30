"use client";

import { useState } from "react";

export function PageMarkdownActions({ markdownUrl }: { markdownUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    try {
      const response = await fetch(markdownUrl);
      const markdown = await response.text();
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="page-markdown-actions">
      <button type="button" onClick={() => void copyMarkdown()}>{copied ? "Copied" : "Copy Markdown"}</button>
      <a href={markdownUrl} target="_blank" rel="noreferrer">View Markdown</a>
    </div>
  );
}
