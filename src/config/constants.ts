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
export const ANTHROPIC_MAX_TOKENS = 2048;

// 0 = current sprint, 1 = previous sprint, 2 = two sprints ago, etc.
export const SPRINT_OFFSET = parseInt(process.env.SPRINT_OFFSET ?? "0", 10);

// Pre-compiled regex
export const BOLD_RE = /\*\*(.+?)\*\*/g;
export const SPRINT_PERIOD_RE = /\((\d{1,2}\/\d{1,2})\s*-\s*(\d{1,2}\/\d{1,2})\)/;
