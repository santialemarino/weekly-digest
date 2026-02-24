/**
 * scheduler.ts — Fastify plugin that loads all cron-enabled digests at startup
 * and schedules them to run automatically.
 *
 * Each digest row with scheduleEnabled=true and a valid scheduleCron is given
 * its own node-cron task. Tasks are cancelled when the server closes.
 *
 * Scheduling changes (enable/disable, cron expression updates) take effect
 * after a server restart. A future improvement could hot-reload via a
 * PATCH /api/digests/:id endpoint hook.
 */

import fp from "fastify-plugin";
import { schedule, validate, type ScheduledTask } from "node-cron";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import logger from "../core/config/logger.js";

export const schedulerPlugin = fp(
    async (server: FastifyInstance) => {
        const tasks: ScheduledTask[] = [];

        const digests = await prisma.digest.findMany({
            where: { scheduleEnabled: true },
        });

        if (digests.length === 0) {
            logger.info("Scheduler: no scheduled digests found");
        }

        for (const digest of digests) {
            if (!digest.scheduleCron) {
                logger.warn(
                    { digestId: digest.id, name: digest.name },
                    "Digest has scheduleEnabled=true but no scheduleCron — skipping"
                );
                continue;
            }

            if (!validate(digest.scheduleCron)) {
                logger.warn(
                    { digestId: digest.id, cron: digest.scheduleCron },
                    "Invalid cron expression — skipping"
                );
                continue;
            }

            const task = schedule(
                digest.scheduleCron,
                async () => {
                    logger.info(
                        { digestId: digest.id, name: digest.name },
                        "Scheduler: triggering digest run"
                    );

                    try {
                        const run = await prisma.digestRun.create({
                            data: {
                                digestId: digest.id,
                                status: "pending",
                                triggeredBy: "schedule",
                            },
                        });

                        // Reuse the same background executor from the routes layer
                        server.executeRun(digest.id, run.id).catch((err: unknown) => {
                            logger.error(
                                { err, digestId: digest.id, runId: run.id },
                                "Scheduled digest run failed"
                            );
                        });
                    } catch (err) {
                        logger.error(
                            { err, digestId: digest.id },
                            "Failed to create scheduled run"
                        );
                    }
                },
                {
                    timezone: digest.scheduleTimezone ?? "UTC",
                }
            );

            tasks.push(task);
            logger.info(
                {
                    digestId: digest.id,
                    name: digest.name,
                    cron: digest.scheduleCron,
                    tz: digest.scheduleTimezone ?? "UTC",
                },
                "Scheduler: digest scheduled"
            );
        }

        // Stop all tasks when the server shuts down
        server.addHook("onClose", async () => {
            for (const task of tasks) task.stop();
            logger.info("Scheduler: all tasks stopped");
        });
    },
    { name: "scheduler", dependencies: ["prisma"] }
);

// Expose executeRun on the server instance so the scheduler can call it
declare module "fastify" {
    interface FastifyInstance {
        executeRun: (digestId: string, runId: string) => Promise<void>;
    }
}
