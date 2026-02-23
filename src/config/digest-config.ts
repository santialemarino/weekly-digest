/**
 * digest-config.ts — Central configuration types for the digest engine.
 *
 * Separates per-digest configuration (data sources, outputs, language)
 * from global secrets (API keys, SMTP credentials).
 *
 * These types are the "contract" between the CLI (reads .env),
 * the API (reads DB), and the core engine (accepts config objects).
 */

import type { DigestTone } from "./i18n.js";
import type { DigestFormat } from "../services/format/types.js";

// Secrets (global, not per-digest)

export interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
}

export interface SecretsConfig {
    clickupToken: string;
    slackToken: string;
    anthropicApiKey: string;
    smtp?: SmtpConfig;
}

// Anthropic Model Config

export interface AnthropicModelConfig {
    /** Primary model (e.g. "claude-sonnet-4-20250514") */
    model: string;
    /** Smaller model for rewrites (e.g. "claude-3-5-haiku-20241022") */
    modelSmall: string;
    /** Max output tokens per call */
    maxTokens: number;
    /** Auto-select smaller model for small contexts */
    autoModel: boolean;
    /** Items threshold below which the small model is used */
    autoModelThreshold: number;
}

// Output Configs

export interface LocalFileOutputConfig {
    driver: "local-file";
    tone: DigestTone | "all";
    formats: DigestFormat[];
    includePdf: boolean;
    /** Override output directory (default: project root / digests /) */
    outputDir?: string;
}

export interface SlackChannelOutputConfig {
    driver: "slack-channel";
    channelId: string;
    format: DigestFormat;
    tone: DigestTone;
}

export interface SlackDmOutputConfig {
    driver: "slack-dm";
    userIds: string[];
    format: DigestFormat;
    tone: DigestTone;
}

export interface EmailOutputConfig {
    driver: "email";
    from: string;
    to: string[];
    format: DigestFormat;
    tone: DigestTone;
    attachPdf: boolean;
}

export type OutputConfig =
    | LocalFileOutputConfig
    | SlackChannelOutputConfig
    | SlackDmOutputConfig
    | EmailOutputConfig;

// Per-Digest Config

export interface DigestConfig {
    /** ClickUp space map: { "Project Name" → "space_id" } */
    clickupSpaceMap: Record<string, string>;
    /** Slack channel groups: { "Project Name" → ["channel_id", ...] } */
    slackChannelGroups: Record<string, string[]>;
    /** Report language */
    language: "en" | "es";
    /** Sprint offset: 0 = current, 1 = previous, etc. */
    sprintOffset: number;
    /** Anthropic model configuration */
    anthropic: AnthropicModelConfig;
    /** PDF generation enabled */
    pdfEnabled: boolean;
    /** Output configurations (where to deliver) */
    outputs: OutputConfig[];
}
