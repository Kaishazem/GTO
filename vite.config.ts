import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: false,
    allowedHosts: true,
    watch: {
      // Exclude Replit-internal runtime directories from Vite's file watcher.
      // Without this, Replit's workflow logger appending a line to
      //   .local/state/workflow-logs/**
      // after every server console.log() causes Vite to broadcast a full-page
      // reload to every connected browser tab — making both the admin page and
      // the user page visibly refresh every time a broadcast is sent.
      // Vercel is unaffected because it runs the production build (no Vite watcher).
      ignored: [
        "**/.local/**",
        "**/.agents/**",
        "**/.cache/**",
      ],
    },
  },
});
