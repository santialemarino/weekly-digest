/**
 * db.ts — Prisma client singleton.
 *
 * A single PrismaClient instance is reused across the process.
 * Do not import PrismaClient directly elsewhere — use this.
 */

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
