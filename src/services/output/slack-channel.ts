/**
 * output/slack-channel.ts — Posts the digest to a Slack channel.
 */

import type { SlackChannelOutputConfig } from "../../config/digest-config.js";
import logger from "../../config/logger.js";
import { pickFormat, type TonedDigests } from "../format/types.js";
import { postToSlack } from "../slack.js";
import type { OutputDriver } from "./types.js";

export function createSlackChannelDriver(
    config: SlackChannelOutputConfig,
    slackToken: string
): OutputDriver {
    return {
        name: "slack-channel",
        tone: config.tone,

        async send(digests: TonedDigests): Promise<void> {
            const digest = digests[config.tone]!;
            logger.info(
                { channel: config.channelId, format: config.format, tone: config.tone },
                "Posting digest to Slack channel"
            );
            await postToSlack(pickFormat(digest, config.format), config.channelId, slackToken);
            logger.info({ channel: config.channelId }, "Slack channel post complete");
        },
    };
}
