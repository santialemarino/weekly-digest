/**
 * main.ts — Entry point. Orchestrates the weekly/sprint digest generation.
 *
 * Pulls closed tasks from ClickUp and messages from Slack,
 * feeds them to Anthropic (Claude), formats the output in all needed
 * tones (informal / formal), and dispatches to enabled outputs.
 */

import { SPRINT_OFFSET, ANTHROPIC_MODEL } from "./config/constants.js";
import { initChannelGroups } from "./config/env.js";
import type { DigestTone } from "./config/i18n.js";
import logger from "./config/logger.js";
import { getAllClickUpData, parseSprintDates } from "./services/clickup.js";
import { getAllSlackData } from "./services/slack.js";
import { buildContext, generateDigest } from "./services/anthropic.js";
import { formatAllTones, type TonedDigests } from "./services/format/index.js";
import { dispatchOutputs, getRequiredTones } from "./services/output/index.js";
import type { DigestMetadata } from "./services/output/index.js";

async function main(): Promise<void> {
    await initChannelGroups();

    const isSprint = SPRINT_OFFSET > 0;
    const reportType = isSprint ? "Sprint Report" : "Weekly Digest";
    logger.info(`Generating Zerf ${reportType}...`);

    // 1 & 2. Fetch ClickUp + Slack data
    // When using sprint offset, Slack dates depend on ClickUp's sprint period → sequential.
    // Otherwise, both sources are independent → parallel (Promise.all).
    let clickupData: Record<string, import("./config/types.js").TaskInfo[]>;
    let slackData: Record<string, string[]>;
    let sprintPeriod: string | null;

    if (isSprint) {
        // Sequential: ClickUp first (we need sprint dates for Slack filtering)
        const sprintLabel = `previous sprint (offset=${SPRINT_OFFSET})`;
        logger.info({ sprint: sprintLabel }, "Fetching ClickUp data");
        const clickup = await getAllClickUpData();
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
        slackData = await getAllSlackData({ oldest: slackOldest, latest: slackLatest });
    } else {
        // Parallel: both fetches are independent
        logger.info("Fetching ClickUp + Slack data in parallel");
        const [clickup, slack] = await Promise.all([getAllClickUpData(), getAllSlackData()]);
        clickupData = clickup.data;
        sprintPeriod = clickup.sprintPeriod;
        slackData = slack;
    }

    const totalTasks = Object.values(clickupData).reduce((sum, t) => sum + t.length, 0);
    const totalMsgs = Object.values(slackData).reduce((sum, m) => sum + m.length, 0);
    logger.info(
        {
            tasks: totalTasks,
            messages: totalMsgs,
            period: sprintPeriod,
        },
        "All data fetched"
    );

    // 3. Determine which tones are needed by enabled outputs
    const neededTones = getRequiredTones();
    logger.info(
        { tones: neededTones, model: ANTHROPIC_MODEL },
        `Generating ${reportType.toLowerCase()}`
    );

    // 4. Generate digest per tone (1 Anthropic call per tone)
    const context = buildContext(clickupData, slackData);
    const rawByTone: Partial<Record<DigestTone, string>> = {};

    for (const tone of neededTones) {
        rawByTone[tone] = await generateDigest(context, isSprint ? sprintPeriod : null, tone);
    }

    logger.info({ tones: neededTones }, "All tone variants generated");

    // 5. Format each tone into all output variants (md, html, json, txt, pdf)
    const meta: DigestMetadata = {
        reportType: isSprint ? "sprint" : "weekly",
        date: new Date().toISOString().split("T")[0],
        sprintPeriod,
    };
    const toned: TonedDigests = await formatAllTones(rawByTone, meta);

    // 6. Dispatch to all enabled outputs
    await dispatchOutputs(toned, meta);
}

main().catch((e) => {
    logger.fatal({ err: e }, "Unhandled error");
    process.exit(1);
});
