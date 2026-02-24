/**
 * core/index.ts — Single import point for route handlers.
 *
 * Only exports what API routes actually consume.
 * Internal modules (services, config) import from each other directly.
 */

// Engine
export { runDigest, type DigestResult } from "./core.js";

// Output dispatcher
export { dispatchOutputs } from "./services/output/index.js";
export type { DeliveryResult } from "./services/output/index.js";
export type { DigestMetadata } from "./services/output/types.js";

// Config types (used by buildRunConfig in route handlers)
export type { DigestConfig, SecretsConfig, OutputConfig } from "./config/digest-config.js";

// i18n helpers (used by buildRunConfig)
export type { DigestTone } from "./config/i18n.js";
export { parseTone } from "./config/i18n.js";

// Format helpers (used by buildRunConfig)
export type { DigestFormat, TonedDigests } from "./services/format/types.js";
export { resolveFormat } from "./services/format/types.js";

// Constants (defaults when building AnthropicModelConfig)
export {
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_ANTHROPIC_MODEL_SMALL,
    DEFAULT_ANTHROPIC_MAX_TOKENS,
    DEFAULT_AUTO_MODEL_THRESHOLD,
} from "./config/constants.js";
