// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), tsconfigPaths()],
    resolve: {
      alias: {
        "@": path.resolve("./src"),
      },
    },
    server: {
      allowedHosts: (() => {
        // Explicit APP_DOMAIN takes priority
        if (process.env.APP_DOMAIN) return [process.env.APP_DOMAIN];
        // Auto-extract hostname from APP_URL (e.g. https://kura-booru.lainns.xyz)
        if (process.env.APP_URL) {
          try {
            const host = new URL(process.env.APP_URL).hostname;
            if (host) return [host];
          } catch {}
        }
        // Fallback: allow all hosts (dev convenience)
        return true;
      })(),
    },
  },
});