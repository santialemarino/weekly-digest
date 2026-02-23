/**
 * index.ts — Public API for the digest engine.
 *
 * This barrel export is the contract for consumers of the core engine
 * (the future API server, or any other integration).
 *
 * Usage:
 *   import { runDigest, dispatchOutputs, type DigestConfig } from "@weekly-digest/core";
 */

// Core orchestrator
export { runDigest, discoverChannelsByPrefix, type DigestResult } from "./core.js";

// Config types
export type {
    DigestConfig,
    SecretsConfig,
    SmtpConfig,
    AnthropicModelConfig,
    OutputConfig,
    LocalFileOutputConfig,
    SlackChannelOutputConfig,
    SlackDmOutputConfig,
    EmailOutputConfig,
} from "./config/digest-config.js";

// i18n
export type { ReportLang, DigestTone } from "./config/i18n.js";
export { getLabels, getToneInstructions, parseTone } from "./config/i18n.js";

// Format types
export type { DigestFormat, FormattedDigest, TonedDigests } from "./services/format/types.js";
export { resolveFormat, pickFormat, FORMAT_EXTENSIONS } from "./services/format/types.js";

// Output dispatcher
export { dispatchOutputs, getRequiredTones } from "./services/output/index.js";
export type { DigestMetadata, OutputDriver } from "./services/output/types.js";

// Data types
export type { TaskInfo, SlackMessage } from "./config/types.js";
