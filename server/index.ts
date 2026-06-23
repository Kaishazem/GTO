import express from "express";
import path from "path";
import postbackRouter from "./routes/postback";
import postbacksAdminRouter from "./routes/postbacks-admin";
import importPlatformRouter from "./routes/import-platform";
import broadcastRouter from "./routes/broadcast";

const app = express();
const IS_PROD = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || (IS_PROD ? "5000" : "5001"), 10);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: IS_PROD ? "production" : "development", ts: Date.now() });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/postback", postbackRouter);
app.use("/api/postbacks-admin", postbacksAdminRouter);
app.use("/api/import-platform", importPlatformRouter);
app.use("/api/broadcast", broadcastRouter);

// ── Production: serve Vite-built frontend ─────────────────────────────────────
if (IS_PROD) {
  const staticDir = path.join(process.cwd(), "dist", "public");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(process.cwd(), "dist", "public", "index.html"));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] ✅ Listening on port ${PORT} (${IS_PROD ? "production" : "development"})`);
  if (!IS_PROD) {
    console.log(`[server] API available at http://localhost:${PORT}/api`);
  }
});

export default app;
