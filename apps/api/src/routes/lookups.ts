/**
 * lookups.ts — Read-only proxy routes for Slack and ClickUp API discovery.
 *
 * Used by the frontend editor to populate channel/space/list pickers.
 * Tokens come from the validated env singleton — never from the client.
 *
 * Registered at: /api/lookups
 *
 * GET /slack/channels          All Slack channels (public + private the bot can see)
 * GET /slack/users             All non-bot Slack users
 * GET /clickup/spaces          All ClickUp spaces in the team
 * GET /clickup/spaces/:id/lists  All folders + lists in a space
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { SLACK_API, CLICKUP_API } from "../core/config/constants.js";
import { env } from "../env.js";

// Helpers

function slackHeaders(): HeadersInit {
    return { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` };
}

function clickupHeaders(): HeadersInit {
    return { Authorization: env.CLICKUP_API_TOKEN };
}

async function slackGet(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${SLACK_API}/${path}?${qs}`, { headers: slackHeaders() });
    return res.json();
}

async function clickupGet(path: string): Promise<unknown> {
    const res = await fetch(`${CLICKUP_API}/${path}`, { headers: clickupHeaders() });
    return res.json();
}

// Route handlers

async function getSlackChannels(_req: FastifyRequest, reply: FastifyReply) {
    const channels: Array<{ id: string; name: string; isPrivate: boolean; memberCount: number }> =
        [];
    let cursor: string | undefined;

    while (true) {
        const params: Record<string, string> = {
            limit: "200",
            types: "public_channel,private_channel",
        };
        if (cursor) params.cursor = cursor;

        const data = (await slackGet("conversations.list", params)) as {
            ok: boolean;
            error?: string;
            channels?: Array<{
                id: string;
                name: string;
                is_private: boolean;
                num_members: number;
            }>;
            response_metadata?: { next_cursor?: string };
        };

        if (!data.ok) {
            // Fall back to public channels only if the bot lacks private channel scope
            if (data.error === "missing_scope") {
                const pub = (await slackGet("conversations.list", {
                    limit: "200",
                    types: "public_channel",
                })) as typeof data;
                for (const c of pub.channels ?? []) {
                    channels.push({
                        id: c.id,
                        name: c.name,
                        isPrivate: c.is_private,
                        memberCount: c.num_members,
                    });
                }
            } else {
                return reply.status(502).send({ error: `Slack API error: ${data.error}` });
            }
            break;
        }

        for (const c of data.channels ?? []) {
            channels.push({
                id: c.id,
                name: c.name,
                isPrivate: c.is_private,
                memberCount: c.num_members,
            });
        }

        const next = data.response_metadata?.next_cursor;
        if (!next) break;
        cursor = next;
    }

    return reply.send({
        channels: channels.sort((a, b) => a.name.localeCompare(b.name)),
    });
}

async function getSlackUsers(_req: FastifyRequest, reply: FastifyReply) {
    const users: Array<{ id: string; name: string; realName: string }> = [];
    let cursor: string | undefined;

    while (true) {
        const params: Record<string, string> = { limit: "200" };
        if (cursor) params.cursor = cursor;

        const data = (await slackGet("users.list", params)) as {
            ok: boolean;
            error?: string;
            members?: Array<{
                id: string;
                name: string;
                real_name?: string;
                is_bot: boolean;
            }>;
            response_metadata?: { next_cursor?: string };
        };

        if (!data.ok) {
            if (data.error === "missing_scope") {
                return reply.status(403).send({
                    error: "Missing Slack scope: add users:read to your app and reinstall",
                });
            }
            return reply.status(502).send({ error: `Slack API error: ${data.error}` });
        }

        for (const u of data.members ?? []) {
            if (!u.is_bot && u.id !== "USLACKBOT") {
                users.push({ id: u.id, name: u.name, realName: u.real_name ?? u.name });
            }
        }

        const next = data.response_metadata?.next_cursor;
        if (!next) break;
        cursor = next;
    }

    return reply.send({
        users: users.sort((a, b) => a.realName.localeCompare(b.realName)),
    });
}

async function getClickUpSpaces(_req: FastifyRequest, reply: FastifyReply) {
    // ClickUp requires fetching the team first to get the team ID
    const teams = (await clickupGet("team")) as {
        teams?: Array<{ id: string; name: string }>;
    };

    const team = teams.teams?.[0];
    if (!team) return reply.status(502).send({ error: "No ClickUp team found" });

    const data = (await clickupGet(`team/${team.id}/space?archived=false`)) as {
        spaces?: Array<{ id: string; name: string }>;
    };

    return reply.send({
        teamId: team.id,
        teamName: team.name,
        spaces: (data.spaces ?? []).map((s) => ({ id: s.id, name: s.name })),
    });
}

async function getClickUpLists(
    req: FastifyRequest<{ Params: { spaceId: string } }>,
    reply: FastifyReply
) {
    const { spaceId } = req.params;

    // Fetch folders and folderless lists in parallel
    const [foldersData, folderlessData] = await Promise.all([
        clickupGet(`space/${spaceId}/folder?archived=false`) as Promise<{
            folders?: Array<{
                id: string;
                name: string;
                lists?: Array<{ id: string; name: string; task_count?: number }>;
            }>;
        }>,
        clickupGet(`space/${spaceId}/list?archived=false`) as Promise<{
            lists?: Array<{ id: string; name: string; task_count?: number }>;
        }>,
    ]);

    const folders = (foldersData.folders ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        lists: (f.lists ?? []).map((l) => ({
            id: l.id,
            name: l.name,
            taskCount: l.task_count ?? 0,
        })),
    }));

    const folderlessLists = (folderlessData.lists ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        taskCount: l.task_count ?? 0,
    }));

    return reply.send({ spaceId, folders, folderlessLists });
}

// Plugin

export async function lookupRoutes(server: FastifyInstance) {
    server.get("/slack/channels", getSlackChannels);
    server.get("/slack/users", getSlackUsers);
    server.get("/clickup/spaces", getClickUpSpaces);
    server.get("/clickup/spaces/:spaceId/lists", getClickUpLists);
}
