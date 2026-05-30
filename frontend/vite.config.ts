import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the frontend runs on Vite's port and proxies API/MCP calls to the
// Express backend (default 5101). In production the backend serves the built
// assets directly, so these proxies are dev-only.
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: "./postcss.config.js",
  },
  server: {
    proxy: {
      "/api": "http://localhost:5101",
      "/mcp": "http://localhost:5101",
      "/health": "http://localhost:5101",
    },
  },
});
