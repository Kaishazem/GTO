import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: [
        "**/.local/**",
        "**/.agents/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/server/**",
      ],
    },
  },
  build: {
    outDir: "dist/public",
    chunkSizeWarningLimit: 1600,
  },
});
