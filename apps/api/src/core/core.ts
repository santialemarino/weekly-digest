/**
 * core.ts — Digest engine orchestrator.
 *
 * `runDigest()` is the main entry point for the digest engine.
 * It accepts a DigestConfig + SecretsConfig and returns the generated
 * TonedDigests + metadata — ready to be dispatched to output drivers.
 *
 * Called by API route handlers after building config from the database.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DigestConfig, SecretsConfig } from "./config/digest-config.js";
import type { DigestTone } from "./config/i18n.js";
import logger from "./config/logger.js";
import type { TaskInfo } from "./config/types.js";
import { getAllClickUpData, parseSprintDates } from "./services/clickup.js";
import { getAllSlackData } from "./services/slack.js";
import {
    buildContext,
    generateDigest,
    rewriteTone,
    type AnthropicServiceConfig,
} from "./services/anthropic.js";
import { compressClickUpData, compressSlackData } from "./services/context-compressor.js";
import { formatAllTones, type TonedDigests } from "./services/format/index.js";
import { getRequiredTones, type DigestMetadata } from "./services/output/index.js";

// Result type

export interface DigestResult {
    /** Formatted digests for each tone */
    toned: TonedDigests;
    /** Run metadata */
    metadata: DigestMetadata;
}

// Channel group discovery

/**
 * Discover Slack channels by prefix (auto-discovery mode).
 * Used when slackChannelGroups is empty but project prefixes are provided.
 */
export async function discoverChannelsByPrefix(
    slackToken: string,
    projectPrefixes: Record<string, string[]>
): Promise<Record<string, string[]>> {
    const { SLACK_API } = await import("./config/constants.js");
    const headers = { Authorization: `Bearer ${slackToken}` };

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
            const res = await fetch(`${SLACK_API}/conversations.list?${params}`, { headers });
            const data = await res.json();

            if (!data.ok) {
                if (data.error === "missing_scope") {
                    params.set("types", "public_channel");
                    const res2 = await fetch(`${SLACK_API}/conversations.list?${params}`, {
                        headers,
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

// Main orchestrator

/**
 * Run the full digest pipeline:
 *   1. Fetch ClickUp tasks + Slack messages (parallel when possible)
 *   2. Compress context (strip URLs, dedup, truncate — saves tokens)
 *   3. Generate primary tone via Anthropic (with prompt caching + auto-model)
 *   4. Rewrite for additional tones if needed (cheap small-model call)
 *   5. Format all tones into md/html/json/txt/pdf
 *
 * Returns the TonedDigests + metadata — does NOT dispatch to outputs.
 * Call dispatchOutputs() separately to deliver.
 */
export async function runDigest(
    config: DigestConfig,
    secrets: SecretsConfig
): Promise<DigestResult> {
    const isSprint = config.sprintOffset > 0;
    const reportType = isSprint ? "Sprint Report" : "Weekly Digest";
    logger.info(`Generating Zerf ${reportType}...`);

    // Build Anthropic service config
    const anthropicSvc: AnthropicServiceConfig = {
        client: new Anthropic({ apiKey: secrets.anthropicApiKey }),
        modelConfig: config.anthropic,
        language: config.language,
    };

    // 1. Fetch ClickUp + Slack data
    let clickupData: Record<string, TaskInfo[]>;
    let slackData: Record<string, string[]>;
    let sprintPeriod: string | null;

    const clickupParams = {
        spaceMap: config.clickupSpaceMap,
        sprintOffset: config.sprintOffset,
        clickupToken: secrets.clickupToken,
    };

    const slackParams = {
        channelGroups: config.slackChannelGroups,
        slackToken: secrets.slackToken,
    };

    if (isSprint) {
        // Sequential: ClickUp first (we need sprint dates for Slack filtering)
        const sprintLabel = `previous sprint (offset=${config.sprintOffset})`;
        logger.info({ sprint: sprintLabel }, "Fetching ClickUp data");
        const clickup = await getAllClickUpData(clickupParams);
        clickupData = clickup.data;
        sprintPeriod = clickup.sprintPeriod;

        let slackOldest: number | undefined;
        let slackLatest: number | undefined;
        if (sprintPeriod) {
            const dates = parseSprintDates(sprintPeriod);
            if (dates) {
                slackOldest = dates[0].getTime() / 1000;
                slackLatest = dates[1].getTime() / 1000;
                logger.info({ period: sprintPeriod }, "Fetching Slack messages for sprint period");
            } else {
                logger.warn("Couldn't parse sprint dates — falling back to last 7 days");
            }
        }
        slackData = await getAllSlackData({
            ...slackParams,
            oldest: slackOldest,
            latest: slackLatest,
        });
    } else {
        // Parallel: both fetches are independent
        logger.info("Fetching ClickUp + Slack data in parallel");
        const [clickup, slack] = await Promise.all([
            getAllClickUpData(clickupParams),
            getAllSlackData(slackParams),
        ]);
        clickupData = clickup.data;
        sprintPeriod = clickup.sprintPeriod;
        slackData = slack;
    }

    const totalTasks = Object.values(clickupData).reduce((sum, t) => sum + t.length, 0);
    const totalMsgs = Object.values(slackData).reduce((sum, m) => sum + m.length, 0);
    logger.info(
        { tasks: totalTasks, messages: totalMsgs, period: sprintPeriod },
        "All data fetched"
    );

    // 2. Compress context before sending to Claude
    const compressedClickup = compressClickUpData(clickupData);
    const compressedSlack = compressSlackData(slackData);

    // 3. Determine which tones are needed by configured outputs
    const neededTones = getRequiredTones(config.outputs);
    logger.info(
        { tones: neededTones, model: config.anthropic.model },
        `Generating ${reportType.toLowerCase()}`
    );

    // 4. Generate digest — primary tone with full context, rewrite for extras
    const context = buildContext(compressedClickup, compressedSlack);
    const rawByTone: Partial<Record<DigestTone, string>> = {};

    // Primary tone: full generation
    const primaryTone = neededTones[0];
    rawByTone[primaryTone] = await generateDigest(
        context,
        isSprint ? sprintPeriod : null,
        primaryTone,
        { totalTasks, totalMessages: totalMsgs },
        anthropicSvc
    );

    // Additional tones: cheap rewrite via small model
    for (const tone of neededTones.slice(1)) {
        logger.info({ from: primaryTone, to: tone }, "Rewriting digest for additional tone");
        rawByTone[tone] = await rewriteTone(rawByTone[primaryTone]!, tone, anthropicSvc);
    }

    logger.info({ tones: neededTones }, "All tone variants generated");

    // 5. Format each tone into all output variants (md, html, json, txt, pdf)
    const meta: DigestMetadata = {
        reportType: isSprint ? "sprint" : "weekly",
        date: new Date().toISOString().split("T")[0],
        sprintPeriod,
    };
    const toned: TonedDigests = await formatAllTones(rawByTone, meta, config.pdfEnabled);

    return { toned, metadata: meta };
}
