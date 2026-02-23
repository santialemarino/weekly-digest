/**
 * slack.ts — Slack API functions: messages, threads, channel info, posting.
 */

import {
    SLACK_API,
    SLACK_MSG_LIMIT,
    MIN_MSG_LENGTH,
    LOOKBACK_DAYS,
    SLACK_CHUNK_SIZE,
    SLACK_SEPARATOR,
    BOLD_RE,
} from "../config/constants.js";
import {
    slackConversationsInfoSchema,
    slackConversationsHistorySchema,
    slackConversationsRepliesSchema,
    slackPostMessageSchema,
} from "../config/schema.js";
import type { SlackMessage } from "../config/types.js";
import logger from "../config/logger.js";

// Helpers

function makeHeaders(slackToken: string): HeadersInit {
    return { Authorization: `Bearer ${slackToken}` };
}

function isHumanMessage(msg: SlackMessage): boolean {
    return !msg.subtype && !msg.bot_id && (msg.text ?? "").trim().length > MIN_MSG_LENGTH;
}

// Channel Info

export async function getChannelName(channelId: string, slackToken: string): Promise<string> {
    try {
        const params = new URLSearchParams({ channel: channelId });
        const res = await fetch(`${SLACK_API}/conversations.info?${params}`, {
            headers: makeHeaders(slackToken),
        });
        const json: unknown = await res.json();
        const data = slackConversationsInfoSchema.parse(json);
        return data.channel?.name ?? channelId;
    } catch {
        return channelId;
    }
}

// Threads

async function getThreadReplies(
    channelId: string,
    threadTs: string,
    slackToken: string
): Promise<string[]> {
    try {
        const params = new URLSearchParams({
            channel: channelId,
            ts: threadTs,
            limit: String(SLACK_MSG_LIMIT),
        });
        const res = await fetch(`${SLACK_API}/conversations.replies?${params}`, {
            headers: makeHeaders(slackToken),
        });
        const json: unknown = await res.json();
        const data = slackConversationsRepliesSchema.parse(json);
        if (!data.ok) return [];

        // First message is the parent — skip it, keep only actual replies
        const replies: SlackMessage[] = (data.messages ?? []).slice(1);
        return replies.filter(isHumanMessage).map((m) => (m.text ?? "").trim());
    } catch {
        return [];
    }
}

// Messages

export async function getChannelMessages(
    channelId: string,
    slackToken: string,
    {
        days = LOOKBACK_DAYS,
        oldest,
        latest,
    }: { days?: number; oldest?: number; latest?: number } = {}
): Promise<string[]> {
    const params = new URLSearchParams({
        channel: channelId,
        oldest: String(oldest ?? Date.now() / 1000 - days * 24 * 60 * 60),
        limit: String(SLACK_MSG_LIMIT),
    });
    if (latest !== undefined) {
        params.set("latest", String(latest));
    }

    let data: ReturnType<typeof slackConversationsHistorySchema.parse> extends infer T ? T : never;
    try {
        const res = await fetch(`${SLACK_API}/conversations.history?${params}`, {
            headers: makeHeaders(slackToken),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json: unknown = await res.json();
        data = slackConversationsHistorySchema.parse(json);
    } catch (e) {
        logger.error({ channelId, err: e }, "Slack request failed");
        return [];
    }

    if (!data.ok) {
        logger.warn(
            { channelId, error: data.error },
            "Slack API error — did you invite the bot to this channel?"
        );
        return [];
    }

    const allMsgs: SlackMessage[] = data.messages ?? [];
    const filtered: string[] = [];
    let threadCount = 0;

    for (const msg of allMsgs) {
        if (isHumanMessage(msg)) {
            filtered.push((msg.text ?? "").trim());
        }

        const replyCount = msg.reply_count ?? 0;
        if (replyCount > 0) {
            threadCount++;
            const replies = await getThreadReplies(channelId, msg.ts!, slackToken);
            for (const reply of replies) {
                filtered.push(`  ↳ ${reply}`);
            }
        }
    }

    if (threadCount > 0) {
        logger.debug({ channelId, threads: threadCount }, "Threads expanded");
    }

    if (allMsgs.length > 0 && filtered.length === 0) {
        const botCount = allMsgs.filter((m) => m.bot_id).length;
        const sysCount = allMsgs.filter((m) => m.subtype).length;
        const shortCount = allMsgs.filter(
            (m) => !m.subtype && !m.bot_id && (m.text ?? "").trim().length <= MIN_MSG_LENGTH
        ).length;
        logger.warn(
            {
                channelId,
                total: allMsgs.length,
                bot: botCount,
                system: sysCount,
                short: shortCount,
            },
            "All messages filtered out"
        );
    }

    return filtered;
}

// Fetch all Slack data (grouped by project)

export interface SlackDataParams {
    channelGroups: Record<string, string[]>;
    slackToken: string;
    oldest?: number;
    latest?: number;
}

export async function getAllSlackData(params: SlackDataParams): Promise<Record<string, string[]>> {
    const { channelGroups, slackToken } = params;
    const entries = Object.entries(channelGroups);

    // Fetch all projects in parallel
    const projectResults = await Promise.all(
        entries.map(async ([project, channelIds]) => {
            const projectName = project.startsWith("C0")
                ? await getChannelName(project, slackToken)
                : project;
            logger.info({ project: projectName }, "Reading Slack project");

            // Fetch all channels within a project in parallel
            const channelResults = await Promise.all(
                channelIds.map(async (cid) => {
                    const name = await getChannelName(cid, slackToken);
                    logger.debug({ channel: `#${name}`, id: cid }, "Reading channel");
                    const msgs = await getChannelMessages(cid, slackToken, {
                        oldest: params.oldest,
                        latest: params.latest,
                    });
                    if (msgs.length > 0) {
                        logger.debug(
                            { channel: `#${name}`, messages: msgs.length },
                            "Messages fetched"
                        );
                    } else {
                        logger.debug({ channel: `#${name}` }, "No messages (empty or error)");
                    }
                    return msgs;
                })
            );

            const projectMsgs = channelResults.flat();

            if (projectMsgs.length > 0) {
                logger.info(
                    { project: projectName, total: projectMsgs.length },
                    "Slack messages collected for project"
                );
            } else {
                logger.info({ project: projectName }, "No Slack messages for project");
            }

            return { projectName, projectMsgs };
        })
    );

    // Build result from parallel outputs
    const result: Record<string, string[]> = {};
    for (const { projectName, projectMsgs } of projectResults) {
        if (projectMsgs.length > 0) {
            result[projectName] = projectMsgs;
        }
    }
    return result;
}

// Posting

function markdownToSlack(text: string): string {
    return text
        .split("\n")
        .map((line) => {
            if (line.startsWith("### ")) return `*${line.slice(4).trim()}*`;
            if (line.startsWith("## ")) return `*${line.slice(3).trim()}*`;
            if (line.startsWith("# ")) return `*${line.slice(2).trim()}*`;
            if (line.trim() === "---") return SLACK_SEPARATOR;
            return line.replace(BOLD_RE, "*$1*");
        })
        .join("\n");
}

export async function postToSlack(
    text: string,
    channel: string,
    slackToken: string
): Promise<void> {
    let remaining = markdownToSlack(text);
    const headers = { ...makeHeaders(slackToken), "Content-Type": "application/json" };

    const chunks: string[] = [];
    while (remaining.length > SLACK_CHUNK_SIZE) {
        let splitAt = remaining
            .slice(0, SLACK_CHUNK_SIZE)
            .lastIndexOf("\n" + SLACK_SEPARATOR.slice(0, 3));
        if (splitAt === -1) splitAt = remaining.slice(0, SLACK_CHUNK_SIZE).lastIndexOf("\n");
        if (splitAt <= 0) splitAt = SLACK_CHUNK_SIZE;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
    }
    chunks.push(remaining);

    for (let i = 0; i < chunks.length; i++) {
        try {
            const res = await fetch(`${SLACK_API}/chat.postMessage`, {
                method: "POST",
                headers,
                body: JSON.stringify({ channel, text: chunks[i], mrkdwn: true }),
            });
            const json: unknown = await res.json();
            const result = slackPostMessageSchema.parse(json);
            if (!result.ok) {
                logger.error({ error: result.error }, "Slack post error");
            } else {
                logger.info({ part: `${i + 1}/${chunks.length}` }, "Slack message posted");
            }
        } catch (e) {
            logger.error({ part: `${i + 1}/${chunks.length}`, err: e }, "Slack post failed");
        }
    }
}
