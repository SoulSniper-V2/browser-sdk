import type { Metadata } from "next";
import "./globals.css";
import { Provider } from "@/components/Provider";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Browser SDK | Keep browser work moving",
    template: "%s | Browser SDK",
  },
  description: "One typed browser API with provider-aware sessions, rendering, and failover for agents and TypeScript applications.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Browser SDK | Keep browser work moving",
    description: "One typed browser API with provider-aware sessions, rendering, and failover.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body><Provider>{children}</Provider></body>
    </html>
  );
}
