/**
 * digests.ts — CRUD routes for Digest templates + run/preview triggers.
 *
 * Registered at: /api/digests
 *
 * GET    /             List all digests
 * POST   /             Create a new digest
 * GET    /:id          Get a single digest
 * PUT    /:id          Update a digest
 * DELETE /:id          Delete a digest
 * POST   /:id/run      Trigger a run (async, returns runId immediately)
 * POST   /:id/preview  Generate a preview (returns content, no delivery)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod/v4";

/** Prisma "record not found" error code — thrown by update/delete when the row doesn't exist. */
function isNotFound(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2025"
    );
}
import { env } from "../env.js";
import {
    runDigest,
    dispatchOutputs,
    parseTone,
    resolveFormat,
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_ANTHROPIC_MODEL_SMALL,
    DEFAULT_ANTHROPIC_MAX_TOKENS,
    DEFAULT_AUTO_MODEL_THRESHOLD,
    type DigestConfig,
    type SecretsConfig,
    type OutputConfig,
    type DigestResult,
} from "../core/index.js";

// Prisma-compatible JSON type. Zod infers config as Record<string, unknown>,
// but Prisma's JSON input doesn't accept `unknown` values — this cast narrows it.
type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

// DTOs that mirror the Prisma schema — avoids a hard dependency on the generated client types (which require `prisma generate` to have run first).
interface DigestOutputRow {
    id: string;
    driver: string;
    enabled: boolean;
    tone: string;
    format: string;
    config: unknown;
}

interface DigestRow {
    id: string;
    clickupSpaceMap: unknown;
    slackChannelGroups: unknown;
    language: string;
    sprintOffset: number;
    pdfEnabled: boolean;
    anthropicModel: string | null;
    anthropicModelSmall: string | null;
    autoModel: boolean;
    autoModelThreshold: number;
    outputs: DigestOutputRow[];
}

// Validation

const outputSchema = z.object({
    driver: z.enum(["slack_channel", "slack_dm", "email", "local_file"]),
    enabled: z.boolean().default(true),
    tone: z.enum(["informal", "formal"]).default("informal"),
    format: z.enum(["markdown", "html", "json", "plainText", "pdf"]).default("markdown"),
    config: z.record(z.string(), z.unknown()).default({}),
});

const digestBodySchema = z.object({
    name: z.string().min(1),
    clickupSpaceMap: z.record(z.string(), z.string()),
    slackChannelGroups: z.record(z.string(), z.array(z.string())),
    language: z.enum(["es", "en"]).default("es"),
    sprintOffset: z.number().int().min(0).default(0),
    pdfEnabled: z.boolean().default(true),
    anthropicModel: z.string().optional(),
    anthropicModelSmall: z.string().optional(),
    autoModel: z.boolean().default(true),
    autoModelThreshold: z.number().int().min(1).default(DEFAULT_AUTO_MODEL_THRESHOLD),
    scheduleEnabled: z.boolean().default(false),
    scheduleCron: z.string().optional(),
    scheduleTimezone: z.string().optional(),
    outputs: z.array(outputSchema).default([]),
});

// Config Mapper

/**
 * Maps a Prisma Digest record + its outputs to the typed DigestConfig + SecretsConfig
 * that the engine expects. Secrets come from the validated env singleton.
 */
function buildRunConfig(digest: DigestRow): {
    config: DigestConfig;
    secrets: SecretsConfig;
} {
    const outputs: OutputConfig[] = digest.outputs
        .filter((o: DigestOutputRow) => o.enabled)
        .map((o: DigestOutputRow): OutputConfig => {
            const tone = parseTone(o.tone);
            const format = resolveFormat(o.format) ?? "markdown";
            const cfg = o.config as Record<string, unknown>;

            switch (o.driver) {
                case "slack_channel":
                    return {
                        driver: "slack-channel",
                        channelId: String(cfg.channelId ?? ""),
                        tone,
                        format,
                    };
                case "slack_dm":
                    return {
                        driver: "slack-dm",
                        userIds: Array.isArray(cfg.userIds) ? cfg.userIds.map(String) : [],
                        tone,
                        format,
                    };
                case "email":
                    return {
                        driver: "email",
                        from: String(cfg.from ?? ""),
                        to: Array.isArray(cfg.to) ? cfg.to.map(String) : [],
                        tone,
                        format,
                        attachPdf: Boolean(cfg.attachPdf ?? false),
                    };
                case "local_file":
                    return {
                        driver: "local-file",
                        tone: (cfg.tone as "informal" | "formal" | "all") ?? tone,
                        formats: Array.isArray(cfg.formats)
                            ? cfg.formats.map((f) => resolveFormat(String(f)) ?? "markdown")
                            : ["markdown"],
                        includePdf: Boolean(cfg.includePdf ?? false),
                    };
                default:
                    throw new Error(`Unknown output driver: ${o.driver}`);
            }
        });

    const config: DigestConfig = {
        clickupSpaceMap: digest.clickupSpaceMap as Record<string, string>,
        slackChannelGroups: digest.slackChannelGroups as Record<string, string[]>,
        language: digest.language as "en" | "es",
        sprintOffset: digest.sprintOffset,
        pdfEnabled: digest.pdfEnabled,
        anthropic: {
            model: digest.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL,
            modelSmall: digest.anthropicModelSmall ?? DEFAULT_ANTHROPIC_MODEL_SMALL,
            maxTokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
            autoModel: digest.autoModel,
            autoModelThreshold: digest.autoModelThreshold,
        },
        outputs,
    };

    const secrets: SecretsConfig = {
        clickupToken: env.CLICKUP_API_TOKEN,
        slackToken: env.SLACK_BOT_TOKEN,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        ...(env.SMTP_HOST && {
            smtp: {
                host: env.SMTP_HOST,
                port: env.SMTP_PORT,
                user: env.SMTP_USER ?? "",
                pass: env.SMTP_PASS ?? "",
            },
        }),
    };

    return { config, secrets };
}

// Background executor

async function executeRun(server: FastifyInstance, digestId: string, runId: string): Promise<void> {
    const { prisma } = server;

    await prisma.digestRun.update({ where: { id: runId }, data: { status: "running" } });

    try {
        const digest = await prisma.digest.findUniqueOrThrow({
            where: { id: digestId },
            include: { outputs: true },
        });

        const { config, secrets } = buildRunConfig(digest);
        const result: DigestResult = await runDigest(config, secrets);

        await dispatchOutputs(result.toned, result.metadata, config.outputs, secrets);

        await prisma.digestRun.update({
            where: { id: runId },
            data: {
                status: "done",
                sprintPeriod: result.metadata.sprintPeriod ?? null,
                rawDigests: Object.fromEntries(
                    Object.entries(result.toned).map(([tone, fmt]) => [tone, fmt?.markdown ?? ""])
                ),
                completedAt: new Date(),
            },
        });

        server.log.info({ digestId, runId }, "Digest run completed");
    } catch (err) {
        await prisma.digestRun.update({
            where: { id: runId },
            data: { status: "failed", error: String(err), completedAt: new Date() },
        });
        throw err;
    }
}

// Routes

export async function digestRoutes(server: FastifyInstance) {
    const { prisma } = server;

    // List all digests
    server.get("/", async (_req: FastifyRequest, reply: FastifyReply) => {
        const digests = await prisma.digest.findMany({
            include: {
                outputs: true,
                runs: { orderBy: { startedAt: "desc" }, take: 1 },
            },
            orderBy: { updatedAt: "desc" },
        });
        return reply.send(digests);
    });

    // Get single digest
    server.get(
        "/:id",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const digest = await prisma.digest.findUnique({
                where: { id: req.params.id },
                include: {
                    outputs: true,
                    runs: { orderBy: { startedAt: "desc" }, take: 5 },
                },
            });
            if (!digest) return reply.status(404).send({ error: "Digest not found" });
            return reply.send(digest);
        }
    );

    // Create digest
    server.post("/", async (req: FastifyRequest, reply: FastifyReply) => {
        const result = digestBodySchema.safeParse(req.body);
        if (!result.success) {
            return reply
                .status(400)
                .send({ error: "Validation failed", issues: result.error.issues });
        }

        const { outputs, ...digestData } = result.data;
        const digest = await prisma.digest.create({
            data: {
                ...digestData,
                outputs: {
                    create: outputs.map((o) => ({ ...o, config: o.config as JsonObject })),
                },
            },
            include: { outputs: true },
        });
        return reply.status(201).send(digest);
    });

    // Update digest
    server.put(
        "/:id",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const result = digestBodySchema.partial().safeParse(req.body);
            if (!result.success) {
                return reply
                    .status(400)
                    .send({ error: "Validation failed", issues: result.error.issues });
            }

            const { outputs, ...digestData } = result.data;
            try {
                const digest = await prisma.digest.update({
                    where: { id: req.params.id },
                    data: {
                        ...digestData,
                        ...(outputs && {
                            outputs: {
                                deleteMany: {},
                                create: outputs.map((o) => ({
                                    ...o,
                                    config: o.config as JsonObject,
                                })),
                            },
                        }),
                    },
                    include: { outputs: true },
                });
                return reply.send(digest);
            } catch (err) {
                if (isNotFound(err)) return reply.status(404).send({ error: "Digest not found" });
                throw err;
            }
        }
    );

    // Delete digest
    server.delete(
        "/:id",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            try {
                await prisma.digest.delete({ where: { id: req.params.id } });
                return reply.status(204).send();
            } catch (err) {
                if (isNotFound(err)) return reply.status(404).send({ error: "Digest not found" });
                throw err;
            }
        }
    );

    // Trigger a run (async — returns immediately with runId)
    server.post(
        "/:id/run",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const digest = await prisma.digest.findUnique({
                where: { id: req.params.id },
                include: { outputs: true },
            });
            if (!digest) return reply.status(404).send({ error: "Digest not found" });

            const run = await prisma.digestRun.create({
                data: { digestId: digest.id, status: "pending", triggeredBy: "manual" },
            });

            // Fire and forget — poll GET /:id/runs/:runId for status
            executeRun(server, digest.id, run.id).catch((err) => {
                server.log.error({ err, runId: run.id }, "Background digest run failed");
            });

            return reply.status(202).send({ runId: run.id, status: "pending" });
        }
    );

    // Get run status — poll this after POST /:id/run
    server.get(
        "/:id/runs/:runId",
        async (
            req: FastifyRequest<{ Params: { id: string; runId: string } }>,
            reply: FastifyReply
        ) => {
            const run = await prisma.digestRun.findUnique({
                where: { id: req.params.runId, digestId: req.params.id },
                include: { deliveries: true },
            });
            if (!run) return reply.status(404).send({ error: "Run not found" });
            return reply.send(run);
        }
    );

    // Preview — generate content without delivering to outputs
    server.post(
        "/:id/preview",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const digest = await prisma.digest.findUnique({
                where: { id: req.params.id },
                include: { outputs: true },
            });
            if (!digest) return reply.status(404).send({ error: "Digest not found" });

            try {
                const { config, secrets } = buildRunConfig(digest);
                const result: DigestResult = await runDigest(config, secrets);

                return reply.send({
                    metadata: result.metadata,
                    tones: Object.fromEntries(
                        Object.entries(result.toned).map(([tone, fmt]) => [
                            tone,
                            {
                                markdown: fmt?.markdown,
                                html: fmt?.html,
                                json: fmt?.json,
                                plainText: fmt?.plainText,
                                // pdf excluded from preview (too large)
                            },
                        ])
                    ),
                });
            } catch (err) {
                server.log.error({ err }, "Preview generation failed");
                return reply
                    .status(500)
                    .send({ error: "Preview generation failed", detail: String(err) });
            }
        }
    );
}
