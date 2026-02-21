/**
 * schema.ts — Zod schemas for environment variables and API responses.
 *
 * Centralizes all validation: env vars are validated once at startup,
 * API responses are validated on every call for runtime safety.
 */

import { z } from "zod/v4";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Parse a JSON string into an object, or fail with a readable message. */
const jsonRecord = (label: string) =>
    z
        .string()
        .min(1, `${label} is required`)
        .transform((val, ctx) => {
            try {
                return JSON.parse(val) as Record<string, unknown>;
            } catch {
                ctx.addIssue({ code: "custom", message: `${label} is not valid JSON` });
                return z.NEVER;
            }
        });

// ─── Environment Variables ────────────────────────────────────────────

export const envSchema = z.object({
    // Required
    SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
    CLICKUP_API_TOKEN: z.string().min(1, "CLICKUP_API_TOKEN is required"),
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    SLACK_DIGEST_CHANNEL: z.string().min(1, "SLACK_DIGEST_CHANNEL is required"),

    // JSON mappings (required)
    CLICKUP_SPACE_MAP: jsonRecord("CLICKUP_SPACE_MAP").pipe(z.record(z.string(), z.string())),
    // SLACK_CHANNEL_GROUPS validated later (depends on USE_SLACK_SECTIONS)

    // Optional
    REPORT_LANG: z.enum(["es", "en"]).optional().default("es"),
    SPRINT_OFFSET: z.coerce.number().int().min(0).optional().default(0),
    ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-4-20250514"),
    LOG_LEVEL: z
        .enum(["trace", "debug", "info", "warn", "error", "fatal"])
        .optional()
        .default("info"),
    USE_SLACK_SECTIONS: z
        .string()
        .optional()
        .default("false")
        .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase())),
});

export type EnvConfig = z.infer<typeof envSchema>;

// ─── ClickUp API Response Schemas ─────────────────────────────────────

export const clickupFolderSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const clickupFoldersResponseSchema = z.object({
    folders: z.array(clickupFolderSchema).default([]),
});

export const clickupListSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const clickupListsResponseSchema = z.object({
    lists: z.array(clickupListSchema).default([]),
});

const clickupAssigneeSchema = z.object({
    username: z.string().optional().default(""),
});

const clickupStatusSchema = z.object({
    status: z.string().optional().default(""),
});

export const clickupTaskSchema = z.object({
    name: z.string().optional().default(""),
    status: clickupStatusSchema.optional().default({ status: "" }),
    assignees: z.array(clickupAssigneeSchema).optional().default([]),
    description: z.string().optional().default(""),
    list: z
        .object({ name: z.string().optional().default("") })
        .optional()
        .default({ name: "" }),
});

export const clickupTasksResponseSchema = z.object({
    tasks: z.array(clickupTaskSchema).default([]),
});

// ─── Slack API Response Schemas ───────────────────────────────────────

export const slackChannelSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const slackMessageSchema = z.object({
    text: z.string().optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
    reply_count: z.number().optional(),
    ts: z.string().optional(),
});

export const slackConversationsListSchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    channels: z.array(slackChannelSchema).optional().default([]),
    response_metadata: z.object({ next_cursor: z.string().optional() }).optional().default({}),
});

export const slackConversationsHistorySchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    messages: z.array(slackMessageSchema).optional().default([]),
});

export const slackConversationsInfoSchema = z.object({
    ok: z.boolean().optional().default(false),
    channel: z.object({ name: z.string().optional() }).optional(),
});

export const slackConversationsRepliesSchema = z.object({
    ok: z.boolean(),
    messages: z.array(slackMessageSchema).optional().default([]),
});

export const slackPostMessageSchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
});

export const slackConversationsOpenSchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    channel: z.object({ id: z.string().optional() }).optional(),
});

export const slackUsersListSchema = z.object({
    ok: z.boolean(),
    members: z
        .array(
            z.object({
                id: z.string(),
                name: z.string().optional().default(""),
                real_name: z.string().optional().default(""),
                is_bot: z.boolean().optional().default(false),
            })
        )
        .optional()
        .default([]),
    response_metadata: z.object({ next_cursor: z.string().optional() }).optional().default({}),
});
