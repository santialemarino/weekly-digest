/**
 * prisma.ts — Fastify plugin that decorates the server with the Prisma client.
 *
 * Wrapped with fastify-plugin so the decoration is applied to the root scope
 * and visible to all sibling and child plugins (e.g. route handlers).
 *
 * Usage inside route handlers:
 *   const { prisma } = server;
 */

import fp from "fastify-plugin";
import { prisma } from "../db.js";
import type { FastifyInstance } from "fastify";

export const prismaPlugin = fp(
    async (server: FastifyInstance) => {
        server.decorate("prisma", prisma);

        server.addHook("onClose", async () => {
            await prisma.$disconnect();
        });
    },
    { name: "prisma" }
);

// Extend Fastify types
declare module "fastify" {
    interface FastifyInstance {
        prisma: typeof prisma;
    }
}
