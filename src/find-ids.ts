/**
 * find-ids.ts — Utility to discover Slack channel IDs and ClickUp workspace structure.
 * Run this whenever you need to look up IDs for configuring the weekly-digest pipeline.
 * Requires SLACK_BOT_TOKEN and CLICKUP_API_TOKEN in a .env file.
 *
 * Usage: pnpm find-ids
 */

import "dotenv/config";
import logger from "./config/logger.js";

// Constants

const SLACK_API = "https://slack.com/api";
const CLICKUP_API = "https://api.clickup.com/api/v2";
const SLACK_PAGE_LIMIT = 200;

// Setup

const slackHeaders: HeadersInit = {
    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
};

const clickupHeaders: HeadersInit = {
    Authorization: process.env.CLICKUP_API_TOKEN ?? "",
};

interface SlackChannel {
    id: string;
    name: string;
    is_private: boolean;
    num_members: number;
}

async function getAllSlackChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;

    while (true) {
        const params = new URLSearchParams({
            limit: String(SLACK_PAGE_LIMIT),
            types: "public_channel,private_channel",
        });
        if (cursor) params.set("cursor", cursor);

        const res = await fetch(`${SLACK_API}/conversations.list?${params}`, {
            headers: slackHeaders,
        });
        const data = await res.json();

        if (!data.ok) {
            logger.error({ error: data.error }, "Slack API error");
            break;
        }

        channels.push(...(data.channels ?? []));

        const nextCursor = data.response_metadata?.next_cursor;
        if (!nextCursor) break;
        cursor = nextCursor;
    }

    return channels;
}

// Compact one-line helpers (avoid pino's multi-line structured output for large lists)
const pad = (s: string, n: number) => s.padEnd(n);

// Runner

async function run() {
    // ── Slack channels ───────────────────────────────────────────────────
    console.log("\n=== SLACK CHANNELS ===\n");
    const allChannels = await getAllSlackChannels();
    const sorted = allChannels.sort((a, b) => a.name.localeCompare(b.name));

    for (const c of sorted) {
        const vis = c.is_private ? "priv" : "pub ";
        console.log(
            `  #${pad(c.name, 35)} ${pad(c.id, 14)} ${vis}  ${c.num_members ?? "?"} members`
        );
    }
    console.log(`\n  Total: ${allChannels.length} channels\n`);

    // ── Slack users ─────────────────────────────────────────────────────
    console.log("=== SLACK USERS ===\n");
    const users: Array<{ id: string; name: string; real_name: string; is_bot: boolean }> = [];
    let userCursor: string | undefined;

    while (true) {
        const params = new URLSearchParams({ limit: "200" });
        if (userCursor) params.set("cursor", userCursor);

        const res = await fetch(`${SLACK_API}/users.list?${params}`, {
            headers: slackHeaders,
        });
        const data = await res.json();

        if (!data.ok) {
            if (data.error === "missing_scope") {
                console.log(
                    "  ⚠ Missing scope: users:read — add it in your Slack app settings and reinstall\n"
                );
            } else {
                logger.error({ error: data.error }, "Failed to list Slack users");
            }
            break;
        }

        users.push(...(data.members ?? []));

        const next = data.response_metadata?.next_cursor;
        if (!next) break;
        userCursor = next;
    }

    if (users.length > 0) {
        const people = users
            .filter((u) => !u.is_bot && u.id !== "USLACKBOT")
            .sort((a, b) => (a.real_name ?? a.name).localeCompare(b.real_name ?? b.name));

        for (const u of people) {
            console.log(`  ${pad(u.real_name || u.name, 35)} ${u.id}`);
        }
        console.log(`\n  Total: ${people.length} users\n`);
    }

    // ── ClickUp structure ────────────────────────────────────────────────
    console.log("=== CLICKUP STRUCTURE ===\n");

    const teamsRes = await fetch(`${CLICKUP_API}/team`, { headers: clickupHeaders });
    const teams = await teamsRes.json();
    const teamId = teams.teams[0].id;
    console.log(`  Team: ${teams.teams[0].name} (${teamId})\n`);

    const spacesRes = await fetch(`${CLICKUP_API}/team/${teamId}/space?archived=false`, {
        headers: clickupHeaders,
    });
    const spaces = await spacesRes.json();

    for (const space of spaces.spaces ?? []) {
        console.log(`  Space: ${space.name}  →  ${space.id}`);

        const foldersRes = await fetch(`${CLICKUP_API}/space/${space.id}/folder?archived=false`, {
            headers: clickupHeaders,
        });
        const foldersData = await foldersRes.json();

        for (const folder of foldersData.folders ?? []) {
            console.log(`    Folder: ${pad(folder.name, 40)}  →  ${folder.id}`);

            const listsRes = await fetch(`${CLICKUP_API}/folder/${folder.id}/list?archived=false`, {
                headers: clickupHeaders,
            });
            const listsData = await listsRes.json();

            for (const lst of listsData.lists ?? []) {
                console.log(
                    `      List: ${pad(lst.name, 35)}  →  ${pad(lst.id, 14)}  (${lst.task_count ?? "?"} tasks)`
                );
            }
        }
        console.log();
    }
}

run().catch((e) => {
    logger.fatal({ err: e }, "Unhandled error");
    process.exit(1);
});
