import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { MobileNav } from "~/components/MobileNav";
import { PwaInit } from "~/components/PwaInit";
import appCss from "~/styles/app.css?url";

const SITE_URL = "https://6bb790b5d4bbac352680a157949e23cb.ctonew.app";
const SITE_TITLE = "DealForge Properties — Sell Your House Fast For Cash";
const SITE_DESCRIPTION =
  "Get a fair cash offer for your home in 24 hours. Close in 7 days. No repairs, no agents, no commissions. DealForge Properties makes selling simple.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      // PWA / mobile-web-app metadata (single-owner app-shell installability
      // for the PWA build; brand colors match the app.css navy/gold tokens).
      { name: "theme-color", content: "#0a1628" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "DealForge" },

      // OpenGraph
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:site_name", content: "DealForge Properties" },
      { property: "og:locale", content: "en_US" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },

      // Canonical
      { name: "canonical", content: SITE_URL },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: SITE_URL },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icons/icon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/favicon-180.png" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-dvh flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold text-white">404 — Page Not Found</h1>
      <p className="mt-4 text-gray-400">The page you're looking for doesn't exist.</p>
      <a href="/" className="mt-6 text-gold-500 hover:underline">
        Go back home →
      </a>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  const routerState = useRouterState();
  const isPpcPage = routerState.location.pathname === "/sell-fast";

  if (isPpcPage) {
    return (
      <RootDocument>
        <Outlet />
      </RootDocument>
    );
  }

  return (
    <RootDocument>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
        {/* Reserve space so the fixed bottom tab bar never covers footer
            content on small screens (mobile only; hidden at md+ alongside it). */}
        <div className="h-20 md:hidden" aria-hidden="true" />
        <MobileNav />
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        {/* Registers the PWA service worker on the client only (SSR-safe). */}
        <PwaInit />
      </body>
    </html>
  );
}
