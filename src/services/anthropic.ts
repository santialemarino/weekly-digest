/**
 * anthropic.ts — Context building, prompt template, and digest generation via Anthropic.
 *
 * Optimizations:
 *   1. Prompt caching — system message + context block marked with cache_control
 *      so the 2nd tone call reuses cached input tokens (~90% cheaper).
 *   2. Smart tone rewriting — when 2 tones are needed, the 1st is generated
 *      from full context; the 2nd is a cheap rewrite (small model, no context).
 *   3. Dynamic model selection — if total items < threshold, uses the smaller
 *      (faster/cheaper) model automatically. Override with ANTHROPIC_AUTO_MODEL=false.
 *   4. Token usage logging — every API call logs input/output/cache token counts.
 */

import {
    ANTHROPIC_MODEL,
    ANTHROPIC_MODEL_SMALL,
    ANTHROPIC_MAX_TOKENS,
    ANTHROPIC_AUTO_MODEL,
    AUTO_MODEL_THRESHOLD,
    MAX_MSGS_PER_CHANNEL,
} from "../config/constants.js";
import { anthropicClient } from "../config/env.js";
import { REPORT_LANG, getLabels, getToneInstructions, type DigestTone } from "../config/i18n.js";
import type { TaskInfo } from "../config/types.js";
import logger from "../config/logger.js";
import { estimateTokens } from "./context-compressor.js";

// ─── TOKEN LOGGING ───────────────────────────────────────────────────

interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

function logTokenUsage(label: string, usage: TokenUsage): void {
    const info: Record<string, number> = {
        input: usage.input_tokens,
        output: usage.output_tokens,
    };
    if (usage.cache_creation_input_tokens) {
        info.cacheWrite = usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens) {
        info.cacheRead = usage.cache_read_input_tokens;
    }
    logger.info({ tokens: info }, `Token usage [${label}]`);
}

// ─── MODEL FALLBACK ──────────────────────────────────────────────────

/**
 * Check if an error is a 404 "model not found" (e.g. Haiku unavailable on free tier).
 * Returns true if the call should be retried with the fallback model.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isModelNotFound(err: any): boolean {
    return (
        err?.status === 404 ||
        String(err).includes("not_found_error") ||
        String(err).includes("404")
    );
}

/**
 * Wrapper that calls the Anthropic API and, if the model returns 404,
 * automatically retries with ANTHROPIC_MODEL (the main/fallback model).
 * This lets us default to Haiku and gracefully degrade if unavailable.
 */
async function callWithModelFallback(
    label: string,
    model: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createParams: (m: string) => any
): Promise<{ text: string; usage: TokenUsage }> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await anthropicClient.messages.create(createParams(model));
            logTokenUsage(label, response.usage as TokenUsage);

            const block = response.content[0];
            if (block.type === "text") {
                return { text: block.text, usage: response.usage as TokenUsage };
            }
            throw new Error("Unexpected response type");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            // Model not found → fall back to main model (once)
            if (isModelNotFound(e) && model !== ANTHROPIC_MODEL) {
                logger.warn(
                    { requestedModel: model, fallbackModel: ANTHROPIC_MODEL },
                    "Model not available on this plan — falling back to main model"
                );
                model = ANTHROPIC_MODEL;
                continue; // retry immediately with fallback model
            }

            // Overloaded → exponential backoff
            if (String(e).toLowerCase().includes("overloaded") && attempt < maxRetries) {
                const wait = attempt * 10;
                logger.warn(
                    { attempt, maxRetries, retrySec: wait },
                    "Anthropic overloaded, retrying..."
                );
                await new Promise((r) => setTimeout(r, wait * 1000));
                continue;
            }

            // Unrecoverable error
            logger.fatal({ err: e }, `Anthropic API error [${label}]`);
            process.exit(1);
        }
    }

    throw new Error(`Failed after ${maxRetries} retries [${label}]`);
}

// ─── MODEL SELECTION ─────────────────────────────────────────────────

function selectModel(totalTasks: number, totalMessages: number): string {
    if (!ANTHROPIC_AUTO_MODEL) return ANTHROPIC_MODEL;

    const totalItems = totalTasks + totalMessages;
    if (totalItems < AUTO_MODEL_THRESHOLD) {
        logger.info(
            { totalItems, threshold: AUTO_MODEL_THRESHOLD, model: ANTHROPIC_MODEL_SMALL },
            "Auto-selected smaller model (low complexity)"
        );
        return ANTHROPIC_MODEL_SMALL;
    }

    logger.debug({ totalItems, model: ANTHROPIC_MODEL }, "Using standard model");
    return ANTHROPIC_MODEL;
}

// ─── BUILD CONTEXT ────────────────────────────────────────────────────

export function buildContext(
    clickupData: Record<string, TaskInfo[]>,
    slackData: Record<string, string[]>
): string {
    const parts: string[] = [];
    const allProjects = [
        ...new Set([...Object.keys(clickupData), ...Object.keys(slackData)]),
    ].sort();

    if (allProjects.length === 0) {
        parts.push("No data found for any project.\n");
        return parts.join("\n");
    }

    for (const project of allProjects) {
        parts.push(`## PROJECT: ${project}\n`);

        // ClickUp tasks for this project
        const tasks = clickupData[project] ?? [];
        if (tasks.length > 0) {
            parts.push(`### Closed tasks (${tasks.length}):`);
            for (const t of tasks) {
                const assignees = t.assignees.join(", ") || "unassigned";
                parts.push(`- [${t.status.toUpperCase()}] ${t.name} (assigned: ${assignees})`);
                if (t.description) {
                    parts.push(`  Description: ${t.description}`);
                }
            }
        } else {
            parts.push("### Closed tasks: 0");
        }
        parts.push("");

        // Slack messages for this project
        const messages = slackData[project] ?? [];
        if (messages.length > 0) {
            parts.push(`### Slack messages (${messages.length}):`);
            for (const msg of messages.slice(0, MAX_MSGS_PER_CHANNEL)) {
                parts.push(`- ${msg}`);
            }
        } else {
            parts.push("### Slack messages: none");
        }
        parts.push("");
    }

    return parts.join("\n");
}

// ─── PROMPT TEMPLATE ──────────────────────────────────────────────────

interface PromptParts {
    /** Shared system message (cacheable — same for all tones) */
    systemBase: string;
    /** Tone-specific system suffix (small, changes per tone) */
    systemToneSuffix: string;
    /** Context data block (cacheable — biggest part, identical for all tones) */
    contextBlock: string;
    /** Prompt instructions (varies by tone — section markers, rules) */
    instructions: string;
}

function buildPromptParts(
    context: string,
    sprintPeriod: string | null,
    tone: DigestTone
): PromptParts {
    const t = getLabels(REPORT_LANG);
    const tn = getToneInstructions(REPORT_LANG, tone);
    const isSprintReport = sprintPeriod !== null;

    const titleDate = isSprintReport ? sprintPeriod : new Date().toISOString().split("T")[0];
    const reportName = isSprintReport ? "Sprint Report" : "Weekly Digest";
    const periodDesc = isSprintReport
        ? `the sprint period ${sprintPeriod}`
        : `the week ending ${titleDate}`;

    // Section markers: emojis for informal, plain text for formal
    const sectionIcons =
        tone === "informal"
            ? {
                  title: "📋",
                  project: "🔧",
                  tasks: "✅",
                  progress: "🚀",
                  decisions: "💡",
                  blockers: "🚧",
                  person: "👤",
              }
            : {
                  title: "",
                  project: "",
                  tasks: "",
                  progress: "",
                  decisions: "",
                  blockers: "",
                  person: "•",
              };

    const titlePrefix = sectionIcons.title ? `${sectionIcons.title} ` : "";
    const projectPrefix = sectionIcons.project ? `${sectionIcons.project} ` : "";
    const personMarker = sectionIcons.person;

    // System message: shared base (cacheable) + tone suffix
    const systemBase =
        "You are the internal assistant for Zerf, a software company focused on the hospitality sector. " +
        `You generate concise, well-structured ${isSprintReport ? "sprint reports" : "weekly digests"}. ` +
        `You ALWAYS write in ${t.langName}.`;

    const systemToneSuffix = tn.systemSuffix;

    // Context data (cacheable — biggest part, identical between tones)
    const contextBlock =
        `Here is the context data grouped by project. Each "## PROJECT: X" block contains ` +
        `the closed tasks and Slack messages for that project.\n\n${context}`;

    // Prompt instructions (vary by tone due to section markers)
    const tasksLabel = sectionIcons.tasks
        ? `${sectionIcons.tasks} ${t.closedTasks}`
        : t.closedTasks;
    const progressLabel = sectionIcons.progress
        ? `${sectionIcons.progress} ${t.progress}`
        : t.progress;
    const decisionsLabel = sectionIcons.decisions
        ? `${sectionIcons.decisions} ${t.keyDecisions}`
        : t.keyDecisions;
    const blockersLabel = sectionIcons.blockers
        ? `${sectionIcons.blockers} ${t.blockers}`
        : t.blockers;

    const instructions = `Your task is to generate the ${reportName} for ${periodDesc}.

IMPORTANT: The projects are ALREADY defined in the context above. Use EXACTLY those project names. Do NOT re-group, split, or merge them by feature or theme.

Generate a ${reportName} in Markdown with EXACTLY this structure:

# ${titlePrefix}${reportName} — ${titleDate}

[3-4 sentences of overview. IMPORTANT: if only ONE project has activity, say so explicitly and use less sentences — ${t.overviewOneProjectHint} Do NOT write as if the whole company was involved if data only covers one project.]

---

[One section per PROJECT from the context above, separated by ---]

## ${projectPrefix}[Exact Project Name from context]

**${tasksLabel}:** [total number]

---

**${progressLabel}:**
- **[Feature/theme 1]:** [1-2 sentences about what was done]
  - ${personMarker} [Person 1], [Person 2], ...
- **[Feature/theme 2]:** [1-2 sentences about what was done]
  - ${personMarker} [Person 1], [Person 2], ...
- **[Feature/theme 3]:** [...]
  - ${personMarker} [Person 1], [Person 2], ...
${t.progressInstruction}

---

**${decisionsLabel}:**
- ${t.keyDecisionsInstruction}
- [Omit this section entirely if there are none]

---

**${blockersLabel}:** [one-liner, or "${t.noBlockers}"]

---

Rules:
- Use EXACTLY the project grouping from the context. Never invent sub-categories or split a project into multiple sections.
- Do NOT list every task individually. Group them by feature/theme into bullet points.
- Each "${t.progress}" bullet: bolded theme name + short description, then a sub-bullet with ${personMarker} and the people who worked on it.
- Use --- (horizontal rule) to separate each section within a project. This is critical for readability.
- If only one project has data, the overview must acknowledge that — never imply it represents the whole company.
- If there's not enough info, omit the section — never invent.
- If a project has no activity at all, skip it entirely.
- ALWAYS leave a blank line between each section. Keep the report airy and easy to scan.
- Tone: ${tn.toneRule}.
${tn.extraRules}
- ${t.writeInLang}`;

    return { systemBase, systemToneSuffix, contextBlock, instructions };
}

// ─── GENERATE DIGEST ──────────────────────────────────────────────────

export interface GenerateOpts {
    totalTasks?: number;
    totalMessages?: number;
}

export async function generateDigest(
    context: string,
    sprintPeriod: string | null = null,
    tone: DigestTone = "informal",
    opts: GenerateOpts = {}
): Promise<string> {
    const { systemBase, systemToneSuffix, contextBlock, instructions } = buildPromptParts(
        context,
        sprintPeriod,
        tone
    );

    // Dynamic model selection
    const model = selectModel(opts.totalTasks ?? 0, opts.totalMessages ?? 0);

    const estimatedInput = estimateTokens(systemBase + contextBlock + instructions);
    logger.info({ tone, model, estimatedInputTokens: estimatedInput }, "Generating digest");

    const { text } = await callWithModelFallback(`generate(${tone})`, model, (m) => ({
        model: m,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        // System: base (cached) + tone suffix
        system: [
            {
                type: "text" as const,
                text: systemBase,
                cache_control: { type: "ephemeral" as const },
            },
            ...(systemToneSuffix ? [{ type: "text" as const, text: systemToneSuffix }] : []),
        ],
        messages: [
            {
                role: "user" as const,
                content: [
                    // Context data (cached — biggest chunk, same across tones)
                    {
                        type: "text" as const,
                        text: contextBlock,
                        cache_control: { type: "ephemeral" as const },
                    },
                    // Prompt instructions (varies by tone — not cached)
                    {
                        type: "text" as const,
                        text: instructions,
                    },
                ],
            },
        ],
    }));

    return text;
}

// ─── REWRITE TONE (cheap 2nd-tone generation) ────────────────────────

/**
 * Rewrite an already-generated digest in a different tone.
 * Uses the small model (Haiku) — no need for the full context, just the
 * ~500-word digest. Input tokens are ~90% fewer than a full generation.
 */
export async function rewriteTone(digest: string, targetTone: DigestTone): Promise<string> {
    const t = getLabels(REPORT_LANG);
    const tn = getToneInstructions(REPORT_LANG, targetTone);

    const systemMsg =
        `You rewrite reports to match a different tone while preserving ALL content, ` +
        `structure, and information. You ALWAYS write in ${t.langName}.` +
        tn.systemSuffix;

    const userMsg =
        `Rewrite the following report to use a ${targetTone} tone.\n\n` +
        `Tone rules: ${tn.toneRule}.\n` +
        `${tn.extraRules}\n\n` +
        `IMPORTANT: Keep EXACTLY the same structure (headings, sections, separator lines). ` +
        `Do NOT add or remove any information. Only change the wording and style.\n\n` +
        `Report:\n\n${digest}`;

    const estimatedInput = estimateTokens(systemMsg + userMsg);
    logger.info(
        { targetTone, model: ANTHROPIC_MODEL_SMALL, estimatedInputTokens: estimatedInput },
        "Rewriting digest tone (cheap call)"
    );

    const { text } = await callWithModelFallback(
        `rewrite(${targetTone})`,
        ANTHROPIC_MODEL_SMALL,
        (m) => ({
            model: m,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: systemMsg,
            messages: [{ role: "user", content: userMsg }],
        })
    );

    return text;
}
