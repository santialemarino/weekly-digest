/**
 * output/types.ts — Shared types for all output drivers.
 */

import type { DigestTone } from "../../config/i18n.js";
import type { TonedDigests } from "../format/types.js";

export interface DigestMetadata {
    /** "weekly" or "sprint" */
    reportType: "weekly" | "sprint";
    /** ISO date string (e.g. "2026-02-20") */
    date: string;
    /** Sprint period label if available (e.g. "2/16 - 3/1") */
    sprintPeriod: string | null;
}

export interface OutputDriver {
    /** Human-readable name for logging */
    name: string;
    /** The tone this driver needs (used to determine which tones to generate) */
    tone: DigestTone;
    /** Deliver the digest. Receives all tone/format variants + metadata. */
    send(digests: TonedDigests, meta: DigestMetadata): Promise<void>;
}
