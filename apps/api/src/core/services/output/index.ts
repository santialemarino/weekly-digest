/**
 * output/index.ts — Output dispatcher.
 *
 * Builds drivers from typed OutputConfig objects and dispatches TonedDigests.
 */

import type { DigestTone } from "../../config/i18n.js";
import type { OutputConfig, SecretsConfig } from "../../config/digest-config.js";
import logger from "../../config/logger.js";
import type { TonedDigests } from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";
import { createLocalFileDriver } from "./local-file.js";
import { createSlackChannelDriver } from "./slack-channel.js";
import { createSlackDmDriver } from "./slack-dm.js";
import { createEmailDriver } from "./email.js";

export type { DigestMetadata } from "./types.js";

/**
 * Build OutputDriver instances from typed config + secrets.
 */
function buildDrivers(outputs: OutputConfig[], secrets: SecretsConfig): OutputDriver[] {
    const drivers: OutputDriver[] = [];

    for (const cfg of outputs) {
        switch (cfg.driver) {
            case "local-file":
                drivers.push(createLocalFileDriver(cfg));
                break;
            case "slack-channel":
                drivers.push(createSlackChannelDriver(cfg, secrets.slackToken));
                break;
            case "slack-dm":
                drivers.push(createSlackDmDriver(cfg, secrets.slackToken));
                break;
            case "email":
                if (secrets.smtp) {
                    drivers.push(createEmailDriver(cfg, secrets.smtp));
                } else {
                    logger.warn("Email output configured but no SMTP secrets — skipping");
                }
                break;
        }
    }

    return drivers;
}

/**
 * Returns the set of tones that are actually needed by the configured outputs.
 */
export function getRequiredTones(outputs: OutputConfig[]): DigestTone[] {
    const tones = new Set<DigestTone>();

    for (const cfg of outputs) {
        if (cfg.driver === "local-file" && cfg.tone === "all") {
            tones.add("informal");
            tones.add("formal");
        } else {
            tones.add(cfg.tone as DigestTone);
        }
    }

    // Default to informal if nothing configured
    if (tones.size === 0) tones.add("informal");
    return [...tones];
}

export async function dispatchOutputs(
    digests: TonedDigests,
    meta: DigestMetadata,
    outputs: OutputConfig[],
    secrets: SecretsConfig
): Promise<void> {
    const drivers = buildDrivers(outputs, secrets);

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
