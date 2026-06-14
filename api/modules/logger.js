// modules/logger.js — Structured stage logger
// Single responsibility: emit consistent, parseable log lines.

export function createLogger(prefix) {
  return {
    stage(stage, status, detail) {
      console.log(`[${prefix}] STAGE ${stage} ${status} | ${detail}`);
    },
    info(msg) {
      console.log(`[${prefix}] INFO | ${msg}`);
    },
    warn(msg) {
      console.warn(`[${prefix}] WARN | ${msg}`);
    },
    error(msg, err) {
      if (err) {
        console.error(`[${prefix}] ERROR | ${msg}`, err);
      } else {
        console.error(`[${prefix}] ERROR | ${msg}`);
      }
    },
  };
}
