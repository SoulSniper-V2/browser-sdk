export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.NODE_ENV === "development" ? "http://localhost:4173" : "https://browser-sdk.dev");

export const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

export const MARKDOWN_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

export function markdownUrl(pathname: string) {
  return pathname === "/docs" ? "/docs.md" : `${pathname}.md`;
}
