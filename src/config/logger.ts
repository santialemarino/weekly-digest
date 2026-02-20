/**
 * logger.ts — Centralized logger using pino.
 *
 * Log levels (from most to least verbose): trace, debug, info, warn, error, fatal.
 * Default level: "info". Override with LOG_LEVEL env var (e.g. LOG_LEVEL=debug).
 */

import pino from "pino";

const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
        },
    },
});

export default logger;
