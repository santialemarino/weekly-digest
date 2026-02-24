/**
 * constants.ts — Pure static constants.
 */

// API base URLs
export const SLACK_API = "https://slack.com/api";
export const CLICKUP_API = "https://api.clickup.com/api/v2";

// Lookback / limits
export const LOOKBACK_DAYS = 7;
export const SLACK_MSG_LIMIT = 100;
export const MIN_MSG_LENGTH = 20;
export const MAX_MSGS_PER_CHANNEL = 20;
export const DESCRIPTION_MAX_LEN = 300;
export const SLACK_CHUNK_SIZE = 2800;
export const SLACK_SEPARATOR = "───────────────────────────";

// ClickUp statuses that count as "done" (case-insensitive)
export const DONE_STATUSES = ["complete", "closed", "finished"];

// Anthropic defaults — used when per-digest overrides are not set
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_ANTHROPIC_MODEL_SMALL = "claude-3-5-haiku-20241022";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 2048;
export const DEFAULT_AUTO_MODEL_THRESHOLD = 20;

// Context compression
export const MAX_SLACK_MSG_CHARS = 500;

// Pre-compiled regex
export const BOLD_RE = /\*\*(.+?)\*\*/g;
export const SPRINT_PERIOD_RE = /\((\d{1,2}\/\d{1,2})\s*-\s*(\d{1,2}\/\d{1,2})\)/;
