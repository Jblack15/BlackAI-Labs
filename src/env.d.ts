/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare global {
  interface Window {
    __fleetclaimTheme?: "light" | "dark";
  }
}

export {};
