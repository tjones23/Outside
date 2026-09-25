import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { AlertNotifier } from "@/components/AlertNotifier";
import { MapHost } from "@/components/map/MapHost";
import { Providers } from "@/components/providers/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader, TabBar } from "@/components/SiteNav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Outside", template: "%s · Outside" },
  description: "Live severe-weather warnings, storm reports, SPC outlooks and radar.",
  // A personal server on a private network; nothing here is for search engines.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Outside", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#08080b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-ink text-text">
        <Providers>
          <SiteHeader />
          <MapHost />
          <main className="relative flex-1">{children}</main>
          <SiteFooter />
          <TabBar />
          <AlertNotifier />
        </Providers>
        <Suspense fallback={null}>
          <RenderPerRequest />
        </Suspense>
      </body>
    </html>
  );
}

/**
 * Makes every page render per request, which the CSP needs.
 *
 * The policy allows inline script only with that request's nonce, and Next
 * stamps the nonce onto its inline bootstrap scripts only when it renders a
 * page for a request. A page prerendered at build time carries scripts with
 * no nonce, which the browser then blocks — and the app never hydrates. The
 * cost is trivial here: every page is a small shell, and all data is fetched
 * client-side from the cached `/api` routes anyway.
 */
async function RenderPerRequest() {
  await connection();
  return null;
}
