import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "https://fleetclaim.ai",
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
});
