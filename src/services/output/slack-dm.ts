/**
 * output/slack-dm.ts — Sends the digest as a direct message to specific Slack users.
 */

import { SLACK_API } from "../../config/constants.js";
import type { SlackDmOutputConfig } from "../../config/digest-config.js";
import logger from "../../config/logger.js";
import { slackConversationsOpenSchema } from "../../config/schema.js";
import { pickFormat, type TonedDigests } from "../format/types.js";
import { postToSlack } from "../slack.js";
import type { OutputDriver } from "./types.js";

async function openDm(userId: string, slackToken: string): Promise<string | null> {
    try {
        const headers = {
            Authorization: `Bearer ${slackToken}`,
            "Content-Type": "application/json",
        };
        const res = await fetch(`${SLACK_API}/conversations.open`, {
            method: "POST",
            headers,
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

export function createSlackDmDriver(config: SlackDmOutputConfig, slackToken: string): OutputDriver {
    return {
        name: "slack-dm",
        tone: config.tone,

        async send(digests: TonedDigests): Promise<void> {
            if (config.userIds.length === 0) {
                logger.warn("Slack DM output enabled but no user IDs configured");
                return;
            }

            const digest = digests[config.tone]!;
            const content = pickFormat(digest, config.format);
            logger.info(
                { recipients: config.userIds.length, format: config.format, tone: config.tone },
                "Sending digest via Slack DM"
            );

            for (const userId of config.userIds) {
                const dmChannelId = await openDm(userId, slackToken);
                if (dmChannelId) {
                    await postToSlack(content, dmChannelId, slackToken);
                    logger.info({ userId }, "DM sent");
                }
            }
        },
    };
}
