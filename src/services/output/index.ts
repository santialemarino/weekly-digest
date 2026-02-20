/**
 * output/index.ts — Output dispatcher.
 *
 * Collects all enabled output drivers, determines which tones they need,
 * and dispatches TonedDigests to each.
 *
 * Each driver is toggled via an OUTPUT_* env var (true/false).
 * Defaults: local-file=true, slack-channel=true, slack-dm=false, email=false.
 */

import type { DigestTone } from "../../config/i18n.js";
import logger from "../../config/logger.js";
import type { TonedDigests } from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";
import { createLocalFileDriver } from "./local-file.js";
import { createSlackChannelDriver } from "./slack-channel.js";
import { createSlackDmDriver } from "./slack-dm.js";
import { createEmailDriver } from "./email.js";

export type { DigestMetadata } from "./types.js";

function isEnabled(envVar: string, defaultValue: boolean): boolean {
    const raw = (process.env[envVar] ?? "").toLowerCase().trim();
    if (!raw) return defaultValue;
    return ["true", "1", "yes"].includes(raw);
}

function getEnabledDrivers(): OutputDriver[] {
    const drivers: OutputDriver[] = [];

    if (isEnabled("OUTPUT_LOCAL_FILE", true)) {
        drivers.push(createLocalFileDriver());
    }
    if (isEnabled("OUTPUT_SLACK_CHANNEL", true)) {
        drivers.push(createSlackChannelDriver());
    }
    if (isEnabled("OUTPUT_SLACK_DM", false)) {
        drivers.push(createSlackDmDriver());
    }
    if (isEnabled("OUTPUT_EMAIL", false)) {
        drivers.push(createEmailDriver());
    }

    return drivers;
}

/**
 * Returns the set of tones that are actually needed by the enabled drivers.
 * Also checks if "all" is requested for local file (saves both tones).
 */
export function getRequiredTones(): DigestTone[] {
    const drivers = getEnabledDrivers();
    const tones = new Set<DigestTone>();

    for (const d of drivers) {
        tones.add(d.tone);
    }

    // If local file driver requests "all" tones, include both
    if (
        isEnabled("OUTPUT_LOCAL_FILE", true) &&
        (process.env.OUTPUT_LOCAL_FILE_TONE ?? "").toLowerCase().trim() === "all"
    ) {
        tones.add("informal");
        tones.add("formal");
    }

    // Default to informal if nothing enabled
    if (tones.size === 0) tones.add("informal");
    return [...tones];
}

export async function dispatchOutputs(digests: TonedDigests, meta: DigestMetadata): Promise<void> {
    const drivers = getEnabledDrivers();

    if (drivers.length === 0) {
        logger.warn("No output drivers enabled — digest was generated but not delivered anywhere");
        return;
    }

    logger.info(
        { drivers: drivers.map((d) => `${d.name}(${d.tone})`) },
        "Dispatching digest to enabled outputs"
    );

    for (const driver of drivers) {
        try {
            await driver.send(digests, meta);
        } catch (e) {
            logger.error({ driver: driver.name, err: e }, "Output driver failed");
        }
    }

    logger.info("All outputs dispatched");
}
