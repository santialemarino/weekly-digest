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

// Anthropic
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
// Small model for rewrites & simple tasks. Defaults to Haiku (cheapest).
// If Haiku isn't available on the plan, the call auto-falls back to ANTHROPIC_MODEL.
export const ANTHROPIC_MODEL_SMALL =
    process.env.ANTHROPIC_MODEL_SMALL ?? "claude-3-5-haiku-20241022";
export const ANTHROPIC_MAX_TOKENS = 2048;

// Auto-model: use the small (cheaper/faster) model when context is small
export const ANTHROPIC_AUTO_MODEL = (() => {
    const raw = (process.env.ANTHROPIC_AUTO_MODEL ?? "true").toLowerCase().trim();
    return ["true", "1", "yes"].includes(raw);
})();
export const AUTO_MODEL_THRESHOLD = 20; // total items (tasks + messages) below this → small model

// Context compression
export const MAX_SLACK_MSG_CHARS = 500; // truncate individual messages longer than this

// 0 = current sprint, 1 = previous sprint, 2 = two sprints ago, etc.
export const SPRINT_OFFSET = parseInt(process.env.SPRINT_OFFSET ?? "0", 10);

// Pre-compiled regex
export const BOLD_RE = /\*\*(.+?)\*\*/g;
export const SPRINT_PERIOD_RE = /\((\d{1,2}\/\d{1,2})\s*-\s*(\d{1,2}\/\d{1,2})\)/;
