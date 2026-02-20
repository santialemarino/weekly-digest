/**
 * output/slack-channel.ts — Posts the digest to a Slack channel.
 *
 * Env: OUTPUT_SLACK_CHANNEL_FORMAT — format to send (default: "markdown").
 *      OUTPUT_SLACK_CHANNEL_TONE  — tone to use (default: "informal").
 *      Options: markdown, html, json, txt
 */

import { DIGEST_CHANNEL } from "../../config/env.js";
import { parseTone, type DigestTone } from "../../config/i18n.js";
import logger from "../../config/logger.js";
import { resolveFormat, pickFormat, type TonedDigests } from "../format/types.js";
import { postToSlack } from "../slack.js";
import type { OutputDriver } from "./types.js";

function getFormat() {
    return resolveFormat(process.env.OUTPUT_SLACK_CHANNEL_FORMAT ?? "markdown") ?? "markdown";
}

function getTone(): DigestTone {
    return parseTone(process.env.OUTPUT_SLACK_CHANNEL_TONE);
}

export function createSlackChannelDriver(): OutputDriver {
    const tone = getTone();
    return {
        name: "slack-channel",
        tone,

        async send(digests: TonedDigests): Promise<void> {
            const fmt = getFormat();
            const digest = digests[tone]!;
            logger.info(
                { channel: DIGEST_CHANNEL, format: fmt, tone },
                "Posting digest to Slack channel"
            );
            await postToSlack(pickFormat(digest, fmt), DIGEST_CHANNEL);
            logger.info({ channel: DIGEST_CHANNEL }, "Slack channel post complete");
        },
    };
}
