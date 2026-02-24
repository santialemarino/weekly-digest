/**
 * server.ts — Fastify API entry point.
 *
 * Env vars are loaded via --env-file in the dev/start scripts (package.json).
 * Validation happens in env.ts — if any required var is missing the process
 * exits here with a clear error before anything else runs.
 */

import { env } from "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { prismaPlugin } from "./plugins/prisma.js";
import { digestRoutes } from "./routes/digests.js";

const server = Fastify({
    logger: {
        level: env.LOG_LEVEL,
        transport:
            env.NODE_ENV !== "production"
                ? {
                      target: "pino-pretty",
                      options: { colorize: true, translateTime: "HH:MM:ss" },
                  }
                : undefined,
    },
});

// Plugins
await server.register(cors, { origin: true });
await server.register(prismaPlugin);

// Routes
await server.register(digestRoutes, { prefix: "/api/digests" });

// Health check
server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
}));

// Start
try {
    await server.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
    server.log.error(err);
    process.exit(1);
}
