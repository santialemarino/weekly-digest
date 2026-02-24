/**
 * prisma.ts — Fastify plugin that decorates the server with the Prisma client.
 *
 * Usage inside route handlers:
 *   const digest = await request.server.prisma.digest.findMany();
 */

import fp from "fastify-plugin";
import { prisma } from "../db.js";
import type { FastifyInstance } from "fastify";

async function prismaPlugin(server: FastifyInstance) {
    server.decorate("prisma", prisma);

    server.addHook("onClose", async () => {
        await prisma.$disconnect();
    });
}

export default fp(prismaPlugin, { name: "prisma" });
export { prismaPlugin };

// Extend Fastify types
declare module "fastify" {
    interface FastifyInstance {
        prisma: typeof prisma;
    }
}
