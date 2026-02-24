/**
 * logger.ts — Centralized pino logger for core services.
 *
 * Dev:        human-readable output via pino-pretty
 * Production: raw JSON (parseable by Datadog, CloudWatch, etc.)
 */

import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    ...(isProd
        ? {} // Raw JSON — let the log aggregator handle formatting
        : {
              transport: {
                  target: "pino-pretty",
                  options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
              },
          }),
});

export default logger;
