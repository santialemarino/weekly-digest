/**
 * env.ts — Builds DigestConfig + SecretsConfig from environment variables.
 *
 * This module is used ONLY by the CLI entry point (cli.ts).
 *
 * Uses Zod (schema.ts) to validate all required env vars at startup.
 * Fails fast with clear error messages if anything is misconfigured.
 */

import "dotenv/config";
import { z } from "zod/v4";
import {
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_ANTHROPIC_MODEL_SMALL,
    DEFAULT_ANTHROPIC_MAX_TOKENS,
    DEFAULT_AUTO_MODEL_THRESHOLD,
} from "./constants.js";
import type {
    DigestConfig,
    SecretsConfig,
    OutputConfig,
    LocalFileOutputConfig,
    SlackChannelOutputConfig,
    SlackDmOutputConfig,
    EmailOutputConfig,
} from "./digest-config.js";
import { parseTone, type ReportLang } from "./i18n.js";
import logger from "./logger.js";
import { envSchema } from "./schema.js";
import { resolveFormat, isPdfFormat, type DigestFormat } from "../services/format/types.js";

// Validate environment variables

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`);
    logger.fatal(`Invalid environment configuration:\n${issues.join("\n")}`);
    process.exit(1);
}

const env = envResult.data;

// Helpers

function isEnvEnabled(envVar: string, defaultValue: boolean): boolean {
    const raw = (process.env[envVar] ?? "").toLowerCase().trim();
    if (!raw) return defaultValue;
    return ["true", "1", "yes"].includes(raw);
}

function isEnvTrue(raw: string | undefined, defaultValue: boolean): boolean {
    if (!raw) return defaultValue;
    return ["true", "1", "yes"].includes(raw.toLowerCase().trim());
}

// Build SecretsConfig

function buildSecrets(): SecretsConfig {
    const secrets: SecretsConfig = {
        clickupToken: env.CLICKUP_API_TOKEN,
        slackToken: env.SLACK_BOT_TOKEN,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
    };

    const smtpHost = process.env.OUTPUT_EMAIL_SMTP_HOST ?? "";
    if (smtpHost) {
        secrets.smtp = {
            host: smtpHost,
            port: parseInt(process.env.OUTPUT_EMAIL_SMTP_PORT ?? "587", 10),
            user: process.env.OUTPUT_EMAIL_SMTP_USER ?? "",
            pass: process.env.OUTPUT_EMAIL_SMTP_PASS ?? "",
        };
    }

    return secrets;
}

// Build Output Configs

const ALL_TEXT_FORMATS: DigestFormat[] = ["markdown", "html", "json", "plainText"];

function buildLocalFileOutput(): LocalFileOutputConfig {
    const raw = (process.env.OUTPUT_LOCAL_FILE_FORMATS ?? "").trim();
    let formats: DigestFormat[] = [];
    let includePdf = true;

    if (raw) {
        includePdf = false;
        for (const token of raw.split(",")) {
            if (isPdfFormat(token)) {
                includePdf = true;
            } else {
                const resolved = resolveFormat(token);
                if (resolved && !formats.includes(resolved)) {
                    formats.push(resolved);
                }
            }
        }
    }

    if (formats.length === 0) formats = [...ALL_TEXT_FORMATS];

    const toneRaw = (process.env.OUTPUT_LOCAL_FILE_TONE ?? "informal").toLowerCase().trim();
    const tone = toneRaw === "all" ? ("all" as const) : parseTone(toneRaw);

    return { driver: "local-file", tone, formats, includePdf };
}

function buildSlackChannelOutput(): SlackChannelOutputConfig {
    return {
        driver: "slack-channel",
        channelId: env.SLACK_DIGEST_CHANNEL,
        format: resolveFormat(process.env.OUTPUT_SLACK_CHANNEL_FORMAT ?? "markdown") ?? "markdown",
        tone: parseTone(process.env.OUTPUT_SLACK_CHANNEL_TONE),
    };
}

function buildSlackDmOutput(): SlackDmOutputConfig {
    const userIds = (process.env.OUTPUT_SLACK_DM_USERS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        driver: "slack-dm",
        userIds,
        format: resolveFormat(process.env.OUTPUT_SLACK_DM_FORMAT ?? "markdown") ?? "markdown",
        tone: parseTone(process.env.OUTPUT_SLACK_DM_TONE),
    };
}

function buildEmailOutput(): EmailOutputConfig {
    const to = (process.env.OUTPUT_EMAIL_TO ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        driver: "email",
        from: process.env.OUTPUT_EMAIL_FROM ?? "",
        to,
        format: resolveFormat(process.env.OUTPUT_EMAIL_FORMAT ?? "html") ?? "html",
        tone: parseTone(process.env.OUTPUT_EMAIL_TONE ?? "formal"),
        attachPdf: isEnvTrue(process.env.OUTPUT_EMAIL_ATTACH_PDF, true),
    };
}

function buildOutputs(): OutputConfig[] {
    const outputs: OutputConfig[] = [];

    if (isEnvEnabled("OUTPUT_LOCAL_FILE", true)) {
        outputs.push(buildLocalFileOutput());
    }
    if (isEnvEnabled("OUTPUT_SLACK_CHANNEL", true)) {
        outputs.push(buildSlackChannelOutput());
    }
    if (isEnvEnabled("OUTPUT_SLACK_DM", false)) {
        outputs.push(buildSlackDmOutput());
    }
    if (isEnvEnabled("OUTPUT_EMAIL", false)) {
        outputs.push(buildEmailOutput());
    }

    return outputs;
}

// Channel Group Resolution

const channelGroupsSchema = z.record(z.string(), z.array(z.string()));
const projectPrefixesSchema = z.record(z.string(), z.array(z.string()));

async function resolveChannelGroups(slackToken: string): Promise<Record<string, string[]>> {
    if (env.USE_SLACK_SECTIONS) {
        // Auto-discovery mode
        const prefixesRaw = (process.env.SLACK_PROJECT_PREFIXES ?? "").trim();
        if (!prefixesRaw) {
            logger.fatal(
                "USE_SLACK_SECTIONS=true requires SLACK_PROJECT_PREFIXES in your .env. " +
                    'Example: SLACK_PROJECT_PREFIXES={"Authorization": ["auth"], "Tipping": ["tipping"]}'
            );
            process.exit(1);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(prefixesRaw);
        } catch {
            logger.fatal("SLACK_PROJECT_PREFIXES is not valid JSON");
            process.exit(1);
        }

        const result = projectPrefixesSchema.safeParse(parsed);
        if (!result.success) {
            logger.fatal(
                "SLACK_PROJECT_PREFIXES has invalid structure. " +
                    'Expected: {"Project": ["prefix1", "prefix2"]}'
            );
            process.exit(1);
        }

        // Import and use the discovery function from core
        const { discoverChannelsByPrefix } = await import("../core.js");
        return discoverChannelsByPrefix(slackToken, result.data);
    } else {
        // Manual mode
        const groupsRaw = (process.env.SLACK_CHANNEL_GROUPS ?? "").trim();
        if (!groupsRaw) {
            logger.fatal(
                "No Slack channel grouping configured. " +
                    "Set SLACK_CHANNEL_GROUPS (JSON) in your .env, e.g.: " +
                    'SLACK_CHANNEL_GROUPS={"Authorization": ["C09MXSJA605"], "Tipping": ["C09873SRQBU"]}'
            );
            process.exit(1);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(groupsRaw);
        } catch {
            logger.fatal("SLACK_CHANNEL_GROUPS is not valid JSON");
            process.exit(1);
        }

        const result = channelGroupsSchema.safeParse(parsed);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`);
            logger.fatal(
                `SLACK_CHANNEL_GROUPS has invalid structure:\n${issues.join("\n")}\n` +
                    'Expected: {"Project": ["channelId1", "channelId2"]}'
            );
            process.exit(1);
        }
        return result.data;
    }
}

// Build DigestConfig

function buildAnthropicConfig() {
    const autoModelRaw = (process.env.ANTHROPIC_AUTO_MODEL ?? "true").toLowerCase().trim();
    return {
        model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
        modelSmall: process.env.ANTHROPIC_MODEL_SMALL ?? DEFAULT_ANTHROPIC_MODEL_SMALL,
        maxTokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
        autoModel: ["true", "1", "yes"].includes(autoModelRaw),
        autoModelThreshold: DEFAULT_AUTO_MODEL_THRESHOLD,
    };
}

// Public API

/**
 * Build DigestConfig + SecretsConfig from environment variables.
 *
 * This is the single entry point for the CLI to get a fully-resolved config.
 * Includes async channel group resolution (auto-discovery or manual JSON).
 */
export async function buildConfigFromEnv(): Promise<{
    config: DigestConfig;
    secrets: SecretsConfig;
}> {
    const secrets = buildSecrets();

    const spaceMap: Record<string, string> = env.CLICKUP_SPACE_MAP;
    const channelGroups = await resolveChannelGroups(secrets.slackToken);

    const lang = (env.REPORT_LANG ?? "es") as ReportLang;
    const sprintOffset = parseInt(process.env.SPRINT_OFFSET ?? "0", 10);
    const pdfEnabled = isEnvEnabled("OUTPUT_PDF", true);

    const config: DigestConfig = {
        clickupSpaceMap: spaceMap,
        slackChannelGroups: channelGroups,
        language: lang,
        sprintOffset,
        anthropic: buildAnthropicConfig(),
        pdfEnabled,
        outputs: buildOutputs(),
    };

    return { config, secrets };
}
