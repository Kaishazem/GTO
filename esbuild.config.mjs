import { build } from "esbuild";

await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.cjs",
  external: [
    "firebase-admin",
    "firebase-admin/app",
    "firebase-admin/firestore",
  ],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
});

console.log("✅ Server bundle written to dist/index.cjs");
