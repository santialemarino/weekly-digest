/**
 * context-compressor.ts — Cleans and compresses raw data before sending to Claude.
 *
 * Goals: reduce token count without losing meaningful information.
 * - Strip URLs from Slack messages (links are noise for a digest)
 * - Truncate overly long messages (stack traces, pasted logs)
 * - Remove near-duplicate consecutive messages
 * - Collapse excessive whitespace
 * - Remove ClickUp descriptions that just repeat the task name
 * - Truncate very long task descriptions
 */

import { DESCRIPTION_MAX_LEN, MAX_SLACK_MSG_CHARS } from "../config/constants.js";
import type { TaskInfo } from "../config/types.js";
import logger from "../config/logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/g;
const MULTI_SPACE_RE = /\s{2,}/g;
const EMOJI_CODE_RE = /:[a-z0-9_+-]+:/g;

/** Replace URLs with [link] and collapse whitespace */
function cleanMessage(msg: string): string {
    return msg
        .replace(URL_RE, "[link]")
        .replace(EMOJI_CODE_RE, "")
        .replace(MULTI_SPACE_RE, " ")
        .trim();
}

/** Truncate a string if it exceeds the limit, appending … */
function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "…";
}

/** Simple prefix-based similarity: same first N chars → duplicate */
function areSimilar(a: string, b: string, prefixLen = 60): boolean {
    if (!a || !b) return false;
    return a.slice(0, prefixLen).toLowerCase() === b.slice(0, prefixLen).toLowerCase();
}

// ─── Public API ──────────────────────────────────────────────────────

/** Compress Slack messages for a single project. */
export function compressSlackMessages(messages: string[]): string[] {
    const cleaned: string[] = [];
    let prev = "";

    for (const raw of messages) {
        const msg = truncate(cleanMessage(raw), MAX_SLACK_MSG_CHARS);
        if (!msg || msg.length < 5) continue;
        if (areSimilar(msg, prev)) continue; // skip near-duplicates
        cleaned.push(msg);
        prev = msg;
    }

    const removed = messages.length - cleaned.length;
    if (removed > 0) {
        logger.debug(
            { original: messages.length, compressed: cleaned.length, removed },
            "Compressed Slack messages"
        );
    }
    return cleaned;
}

/** Compress ClickUp tasks: trim redundant descriptions. */
export function compressTasks(tasks: TaskInfo[]): TaskInfo[] {
    return tasks.map((t) => {
        let desc = t.description.trim();

        // Remove description if it just repeats the task name
        if (desc.toLowerCase() === t.name.toLowerCase()) {
            desc = "";
        }

        // Remove descriptions that are only URLs
        if (/^https?:\/\/\S+$/.test(desc)) {
            desc = "[link]";
        }

        // Truncate overly long descriptions
        if (desc.length > DESCRIPTION_MAX_LEN) {
            desc = desc.slice(0, DESCRIPTION_MAX_LEN) + "…";
        }

        return { ...t, description: desc };
    });
}

/** Compress all ClickUp data (per-project). */
export function compressClickUpData(data: Record<string, TaskInfo[]>): Record<string, TaskInfo[]> {
    const result: Record<string, TaskInfo[]> = {};
    let totalBefore = 0;
    let totalAfter = 0;

    for (const [project, tasks] of Object.entries(data)) {
        totalBefore += tasks.length;
        result[project] = compressTasks(tasks);
        totalAfter += result[project].length;
    }

    logger.debug({ tasksBefore: totalBefore, tasksAfter: totalAfter }, "ClickUp data compressed");
    return result;
}

/** Compress all Slack data (per-project). */
export function compressSlackData(data: Record<string, string[]>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    let totalBefore = 0;
    let totalAfter = 0;

    for (const [project, messages] of Object.entries(data)) {
        totalBefore += messages.length;
        result[project] = compressSlackMessages(messages);
        totalAfter += result[project].length;
    }

    if (totalBefore !== totalAfter) {
        logger.info(
            {
                messagesBefore: totalBefore,
                messagesAfter: totalAfter,
                saved: totalBefore - totalAfter,
            },
            "Slack context compressed"
        );
    }

    return result;
}

/**
 * Estimate token count for a string (~4 chars ≈ 1 token).
 * Used for logging, not billing — real tokenization differs.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
