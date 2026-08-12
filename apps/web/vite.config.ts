import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Order matters, and so does the exact match: a plain string alias for
    // "@tlon/design" is a *prefix* rule, which would rewrite
    // "@tlon/design/tokens.css" into "…/tokens.ts/tokens.css".
    alias: [
      {
        find: /^@tlon\/copy$/,
        replacement: fileURLToPath(new URL("../../packages/copy/disclosure.ts", import.meta.url)),
      },
      {
        find: /^@tlon\/ontology$/,
        replacement: fileURLToPath(new URL("../../packages/ontology/index.ts", import.meta.url)),
      },
      {
        find: "@tlon/copy/headings",
        replacement: fileURLToPath(new URL("../../packages/copy/headings.ts", import.meta.url)),
      },
      {
        find: "@tlon/copy/sections",
        replacement: fileURLToPath(new URL("../../packages/copy/sections.ts", import.meta.url)),
      },
      {
        find: "@tlon/copy/guides",
        replacement: fileURLToPath(new URL("../../packages/copy/guides.ts", import.meta.url)),
      },
      {
        find: "@tlon/design/icons",
        replacement: fileURLToPath(new URL("../../packages/design/icons.ts", import.meta.url)),
      },
      {
        find: "@tlon/design/marks",
        replacement: fileURLToPath(new URL("../../packages/design/marks.ts", import.meta.url)),
      },
      {
        find: "@tlon/design/tokens.css",
        replacement: fileURLToPath(new URL("../../packages/design/tokens.css", import.meta.url)),
      },
      {
        find: /^@tlon\/design$/,
        replacement: fileURLToPath(new URL("../../packages/design/tokens.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts?(x)"],
  },
  server: {
    port: 5173,
    // The API is same-origin in production; in development it lives on 8080.
    proxy: { "/v1": "http://localhost:8080", "/health": "http://localhost:8080" },
  },
});
