import { useEffect } from "react";

/**
 * DealForge PWA — registers the minimal service worker (/sw.js) on the client
 * only. The site is a server-rendered app behind owner auth; the SW is a
 * network-first installability/offline-shell worker (see public/sw.js) and
 * never caches owner data or /api/* traffic.
 *
 * SSR-safe: all browser API access happens inside useEffect, so this component
 * renders nothing and does zero work on the server.
 */
export function PwaInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Wait for load so we don't compete with the initial render / hydration.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* SW is progressive enhancement; fail silently. */
        });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
