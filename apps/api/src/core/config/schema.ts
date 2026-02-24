/**
 * schema.ts — Zod schemas for external API responses.
 *
 * Validates ClickUp and Slack API responses at runtime,
 * catching unexpected changes to third-party APIs early.
 */

import { z } from "zod/v4";

// ClickUp API Response Schemas

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

// Slack API Response Schemas

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
