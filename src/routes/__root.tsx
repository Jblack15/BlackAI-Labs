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
import appCss from "~/styles/app.css?url";

const SITE_URL = "https://dealflowai.com";
const SITE_TITLE = "DealFlow AI — Sell Your House Fast For Cash";
const SITE_DESCRIPTION =
  "Get a fair cash offer for your home in 24 hours. Close in 7 days. No repairs, no agents, no commissions. DealFlow AI makes selling simple.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },

      // OpenGraph
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:site_name", content: "DealFlow AI" },
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
      </body>
    </html>
  );
}
