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
import { slackHeaders, CHANNEL_GROUPS } from "../config/env.js";
import type { SlackMessage } from "../config/types.js";
import logger from "../config/logger.js";

// HELPERS

function isHumanMessage(msg: SlackMessage): boolean {
    return !msg.subtype && !msg.bot_id && (msg.text ?? "").trim().length > MIN_MSG_LENGTH;
}

// CHANNEL INFO

export async function getChannelName(channelId: string): Promise<string> {
    try {
        const params = new URLSearchParams({ channel: channelId });
        const res = await fetch(`${SLACK_API}/conversations.info?${params}`, {
            headers: slackHeaders,
        });
        const data = await res.json();
        return data.channel?.name ?? channelId;
    } catch {
        return channelId;
    }
}

// THREADS

async function getThreadReplies(channelId: string, threadTs: string): Promise<string[]> {
    try {
        const params = new URLSearchParams({
            channel: channelId,
            ts: threadTs,
            limit: String(SLACK_MSG_LIMIT),
        });
        const res = await fetch(`${SLACK_API}/conversations.replies?${params}`, {
            headers: slackHeaders,
        });
        const data = await res.json();
        if (!data.ok) return [];

        // First message is the parent — skip it, keep only actual replies
        const replies: SlackMessage[] = (data.messages ?? []).slice(1);
        return replies.filter(isHumanMessage).map((m) => (m.text ?? "").trim());
    } catch {
        return [];
    }
}

// MESSAGES

export async function getChannelMessages(
    channelId: string,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
        const res = await fetch(`${SLACK_API}/conversations.history?${params}`, {
            headers: slackHeaders,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        data = await res.json();
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
            const replies = await getThreadReplies(channelId, msg.ts!);
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

// FETCH ALL SLACK DATA (grouped by project)

export async function getAllSlackData(opts?: {
    oldest?: number;
    latest?: number;
}): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};

    for (const [project, channelIds] of Object.entries(CHANNEL_GROUPS)) {
        const projectName = project.startsWith("C0") ? await getChannelName(project) : project;
        logger.info({ project: projectName }, "Reading Slack project");

        const projectMsgs: string[] = [];
        for (const cid of channelIds) {
            const name = await getChannelName(cid);
            logger.debug({ channel: `#${name}`, id: cid }, "Reading channel");
            const msgs = await getChannelMessages(cid, {
                oldest: opts?.oldest,
                latest: opts?.latest,
            });
            if (msgs.length > 0) {
                logger.debug({ channel: `#${name}`, messages: msgs.length }, "Messages fetched");
                projectMsgs.push(...msgs);
            } else {
                logger.debug({ channel: `#${name}` }, "No messages (empty or error)");
            }
        }

        if (projectMsgs.length > 0) {
            logger.info(
                { project: projectName, total: projectMsgs.length },
                "Slack messages collected for project"
            );
            result[projectName] = projectMsgs;
        } else {
            logger.info({ project: projectName }, "No Slack messages for project");
        }
    }

    return result;
}

// POSTING

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

export async function postToSlack(text: string, channel: string): Promise<void> {
    let remaining = markdownToSlack(text);

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
                headers: { ...slackHeaders, "Content-Type": "application/json" },
                body: JSON.stringify({ channel, text: chunks[i], mrkdwn: true }),
            });
            const result = await res.json();
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
