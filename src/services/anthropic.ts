/**
 * anthropic.ts — Context building, prompt template, and digest generation via Anthropic.
 *
 * Supports two tones:
 *   - "informal" — casual, emoji-rich, teammate-friendly (default)
 *   - "formal"  — polished, client-facing, no emojis
 *
 * Tone is passed per-call so the same context can produce both variants
 * without re-fetching data.
 */

import {
    ANTHROPIC_MODEL,
    ANTHROPIC_MAX_TOKENS,
    MAX_MSGS_PER_CHANNEL,
} from "../config/constants.js";
import { anthropicClient } from "../config/env.js";
import { REPORT_LANG, getLabels, getToneInstructions, type DigestTone } from "../config/i18n.js";
import type { TaskInfo } from "../config/types.js";
import logger from "../config/logger.js";

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

function buildPrompt(
    context: string,
    sprintPeriod: string | null,
    tone: DigestTone
): { system: string; user: string } {
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

    const system =
        "You are the internal assistant for Zerf, a software company focused on the hospitality sector. " +
        `You generate concise, well-structured ${isSprintReport ? "sprint reports" : "weekly digests"}. ` +
        `You ALWAYS write in ${t.langName}.` +
        tn.systemSuffix;

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

    const user = `Your task is to generate the ${reportName} for ${periodDesc}.

Below is the context grouped by PROJECT. Each "## PROJECT: X" block contains the closed tasks and Slack messages for that project.

${context}

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

    return { system, user };
}

// ─── GENERATE DIGEST ──────────────────────────────────────────────────

export async function generateDigest(
    context: string,
    sprintPeriod: string | null = null,
    tone: DigestTone = "informal"
): Promise<string> {
    const { system: systemMsg, user: userMsg } = buildPrompt(context, sprintPeriod, tone);

    logger.info({ tone }, "Generating digest with tone");

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await anthropicClient.messages.create({
                model: ANTHROPIC_MODEL,
                max_tokens: ANTHROPIC_MAX_TOKENS,
                system: systemMsg,
                messages: [{ role: "user", content: userMsg }],
            });
            const block = response.content[0];
            if (block.type === "text") return block.text;
            throw new Error("Unexpected response type");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            if (String(e).toLowerCase().includes("overloaded") && attempt < maxRetries) {
                const wait = attempt * 10;
                logger.warn(
                    { attempt, maxRetries, retrySec: wait },
                    "Anthropic overloaded, retrying..."
                );
                await new Promise((r) => setTimeout(r, wait * 1000));
            } else {
                logger.fatal({ err: e }, "Anthropic API error");
                process.exit(1);
            }
        }
    }

    // Unreachable, but TypeScript needs it
    throw new Error("Failed after retries");
}
