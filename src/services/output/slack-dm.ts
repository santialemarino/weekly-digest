/**
 * output/slack-dm.ts — Sends the digest as a direct message to specific Slack users.
 *
 * Env: OUTPUT_SLACK_DM_FORMAT — format to send (default: "markdown").
 *      OUTPUT_SLACK_DM_TONE  — tone to use (default: "informal").
 *      OUTPUT_SLACK_DM_USERS — comma-separated Slack user IDs.
 */

import { SLACK_API } from "../../config/constants.js";
import { slackHeaders } from "../../config/env.js";
import { parseTone, type DigestTone } from "../../config/i18n.js";
import logger from "../../config/logger.js";
import { slackConversationsOpenSchema } from "../../config/schema.js";
import { resolveFormat, pickFormat, type TonedDigests } from "../format/types.js";
import { postToSlack } from "../slack.js";
import type { OutputDriver } from "./types.js";

const DM_USERS = (process.env.OUTPUT_SLACK_DM_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function getFormat() {
    return resolveFormat(process.env.OUTPUT_SLACK_DM_FORMAT ?? "markdown") ?? "markdown";
}

function getTone(): DigestTone {
    return parseTone(process.env.OUTPUT_SLACK_DM_TONE);
}

async function openDm(userId: string): Promise<string | null> {
    try {
        const res = await fetch(`${SLACK_API}/conversations.open`, {
            method: "POST",
            headers: { ...slackHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ users: userId }),
        });
        const json: unknown = await res.json();
        const data = slackConversationsOpenSchema.parse(json);
        if (!data.ok) {
            logger.error({ userId, error: data.error }, "Failed to open DM");
            return null;
        }
        return data.channel?.id ?? null;
    } catch (e) {
        logger.error({ userId, err: e }, "Failed to open DM");
        return null;
    }
}

export function createSlackDmDriver(): OutputDriver {
    const tone = getTone();
    return {
        name: "slack-dm",
        tone,

        async send(digests: TonedDigests): Promise<void> {
            if (DM_USERS.length === 0) {
                logger.warn("OUTPUT_SLACK_DM is enabled but OUTPUT_SLACK_DM_USERS is empty");
                return;
            }

            const fmt = getFormat();
            const digest = digests[tone]!;
            const content = pickFormat(digest, fmt);
            logger.info(
                { recipients: DM_USERS.length, format: fmt, tone },
                "Sending digest via Slack DM"
            );

            for (const userId of DM_USERS) {
                const dmChannelId = await openDm(userId);
                if (dmChannelId) {
                    await postToSlack(content, dmChannelId);
                    logger.info({ userId }, "DM sent");
                }
            }
        },
    };
}
