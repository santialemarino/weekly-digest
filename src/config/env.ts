/**
 * env.ts — Environment variable parsing, validation, API headers, and clients.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { SLACK_API } from "./constants.js";
import logger from "./logger.js";

// ENVIRONMENT VARIABLES

export const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN!;
export const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN!;
export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;
export const DIGEST_CHANNEL = process.env.SLACK_DIGEST_CHANNEL!;

// ClickUp space → project mapping (JSON, required). Maps project names to space IDs
// so ClickUp tasks are grouped under the same project name as Slack channels.
//   e.g. CLICKUP_SPACE_MAP={"Project1": "C0XXXXX1A", "Project2": "C0XXXXX2A"}
export let SPACE_MAP: Record<string, string> = {};
export let SPACE_IDS: string[] = [];

const spaceMapRaw = (process.env.CLICKUP_SPACE_MAP ?? "").trim();
if (!spaceMapRaw) {
    logger.fatal(
        "CLICKUP_SPACE_MAP is required. Set it in your .env as JSON, e.g.: " +
            'CLICKUP_SPACE_MAP={"Project1": "C0XXXXX1A", "Project2": "C0XXXXX2A"}'
    );
    process.exit(1);
}
try {
    SPACE_MAP = JSON.parse(spaceMapRaw);
    SPACE_IDS = Object.values(SPACE_MAP);
} catch (e) {
    logger.fatal({ err: e }, "CLICKUP_SPACE_MAP is not valid JSON");
    process.exit(1);
}

/* Two modes, controlled by USE_SLACK_SECTIONS:
 *
 * ── MODE A (USE_SLACK_SECTIONS=false, default) ──────────────────────────────
 * Manual mapping via SLACK_CHANNEL_GROUPS (JSON):
 *   {"Project1": ["C0XXXXX1A", "C0XXXXX1B"], "Project2": ["C0XXXXX2A"]}
 *
 * ── MODE B (USE_SLACK_SECTIONS=true) ────────────────────────────────────────
 * Auto-discovery: the bot fetches ALL channels it has access to and groups
 * them by name prefix. You define the prefixes per project in
 * SLACK_PROJECT_PREFIXES (JSON):
 *   {"Project1": ["project1"], "Project2": ["project2a", "project2b"]}
 *
 * ── FUTURE / IDEAL APPROACH ─────────────────────────────────────────────────
 * TODO: Slack "sidebar sections" (the visual grouping in the Slack client)
 * would be the cleanest way to define project → channel mapping. However,
 * as of 2026-02, the Slack API does NOT expose sidebar sections — they are
 * a per-user client-side feature. If Slack ever adds a public API for
 * workspace-level channel sections/categories, this code should be updated
 * to use that instead of prefix matching.
 */
export const USE_SLACK_SECTIONS = ["true", "1", "yes"].includes(
    (process.env.USE_SLACK_SECTIONS ?? "false").toLowerCase()
);

// VALIDATION

const required: Record<string, string | undefined> = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    CLICKUP_API_TOKEN: process.env.CLICKUP_API_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SLACK_DIGEST_CHANNEL: process.env.SLACK_DIGEST_CHANNEL,
};
const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
if (missing.length > 0) {
    logger.fatal(`Missing required env vars: ${missing.join(", ")} — check your .env file`);
    process.exit(1);
}

// API HEADERS / CLIENTS

export const slackHeaders: HeadersInit = {
    Authorization: `Bearer ${SLACK_TOKEN}`,
};

export const clickupHeaders: HeadersInit = {
    Authorization: CLICKUP_TOKEN,
};

export const anthropicClient = new Anthropic({ apiKey: ANTHROPIC_KEY });

// CHANNEL GROUPS (mutable — initialized at runtime by initChannelGroups)

export let CHANNEL_GROUPS: Record<string, string[]> = {};

async function discoverChannelsByPrefix(): Promise<Record<string, string[]>> {
    const prefixesRaw = (process.env.SLACK_PROJECT_PREFIXES ?? "").trim();
    if (!prefixesRaw) {
        logger.fatal(
            "USE_SLACK_SECTIONS=true requires SLACK_PROJECT_PREFIXES in your .env. " +
                'Example: SLACK_PROJECT_PREFIXES={"Authorization": ["auth"], "Tipping": ["tipping"]}'
        );
        process.exit(1);
    }

    let projectPrefixes: Record<string, string[]> = {};
    try {
        projectPrefixes = JSON.parse(prefixesRaw);
    } catch (e) {
        logger.fatal({ err: e }, "SLACK_PROJECT_PREFIXES is not valid JSON");
        process.exit(1);
    }

    logger.info("Auto-discovering Slack channels by prefix...");
    const allChannels: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;

    while (true) {
        const params = new URLSearchParams({
            limit: "200",
            types: "public_channel,private_channel",
        });
        if (cursor) params.set("cursor", cursor);

        try {
            const res = await fetch(`${SLACK_API}/conversations.list?${params}`, {
                headers: slackHeaders,
            });
            const data = await res.json();

            if (!data.ok) {
                if (data.error === "missing_scope") {
                    params.set("types", "public_channel");
                    const res2 = await fetch(`${SLACK_API}/conversations.list?${params}`, {
                        headers: slackHeaders,
                    });
                    const data2 = await res2.json();
                    if (!data2.ok) break;
                    allChannels.push(...(data2.channels ?? []));
                } else {
                    break;
                }
            } else {
                allChannels.push(...(data.channels ?? []));
            }

            const nextCursor = data.response_metadata?.next_cursor;
            if (!nextCursor) break;
            cursor = nextCursor;
        } catch (e) {
            logger.error({ err: e }, "Failed to list Slack channels");
            break;
        }
    }

    logger.info({ count: allChannels.length }, "Channels discovered");

    const groups: Record<string, string[]> = {};
    for (const project of Object.keys(projectPrefixes)) {
        groups[project] = [];
    }

    let matchedCount = 0;
    for (const ch of allChannels) {
        const chName = ch.name.toLowerCase();
        for (const [project, prefixes] of Object.entries(projectPrefixes)) {
            if (prefixes.some((p) => chName.startsWith(p.toLowerCase()))) {
                groups[project].push(ch.id);
                matchedCount++;
                logger.debug({ channel: ch.name, project }, "Channel matched to project");
                break;
            }
        }
    }

    logger.info(
        { matched: matchedCount, projects: Object.keys(groups).length },
        "Channel auto-discovery complete"
    );

    return Object.fromEntries(Object.entries(groups).filter(([, ids]) => ids.length > 0));
}

export async function initChannelGroups(): Promise<void> {
    if (USE_SLACK_SECTIONS) {
        CHANNEL_GROUPS = await discoverChannelsByPrefix();
    } else {
        const groupsRaw = (process.env.SLACK_CHANNEL_GROUPS ?? "").trim();
        if (groupsRaw) {
            try {
                CHANNEL_GROUPS = JSON.parse(groupsRaw);
            } catch (e) {
                logger.fatal({ err: e }, "SLACK_CHANNEL_GROUPS is not valid JSON");
                process.exit(1);
            }
        } else {
            logger.fatal(
                "No Slack channel grouping configured. " +
                    "Set SLACK_CHANNEL_GROUPS (JSON) in your .env, e.g.: " +
                    'SLACK_CHANNEL_GROUPS={"Authorization": ["C09MXSJA605"], "Tipping": ["C09873SRQBU"]}'
            );
            process.exit(1);
        }
    }
}
