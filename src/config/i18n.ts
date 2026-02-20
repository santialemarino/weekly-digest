/**
 * i18n.ts — Report language translations & tone definitions.
 *
 * Controls the language of the generated digest (section names, labels, etc.)
 * and the tone (informal for teammates, formal for clients).
 *
 * The prompt *instructions* to Claude always stay in English — only the
 * output template and tone are translated.
 *
 * Add new languages by extending the `translations` object.
 * Add new tones by extending the `toneInstructions` object.
 */

// ─── Language ─────────────────────────────────────────────────────────

export type ReportLang = "es" | "en";

export interface ReportLabels {
    /** Full language name for Claude's system message (e.g. "English") */
    langName: string;
    /** Section: closed tasks */
    closedTasks: string;
    /** Section: progress / highlights */
    progress: string;
    /** Section: key decisions */
    keyDecisions: string;
    /** Section: blockers */
    blockers: string;
    /** Default text when no blockers */
    noBlockers: string;
    /** Hint for the overview when only one project has data */
    overviewOneProjectHint: string;
    /** "Write everything in X" rule */
    writeInLang: string;
    /** Progress section instruction */
    progressInstruction: string;
    /** Key decisions instruction */
    keyDecisionsInstruction: string;
}

const translations: Record<ReportLang, ReportLabels> = {
    es: {
        langName: "Spanish",
        closedTasks: "Tareas cerradas",
        progress: "Avances",
        keyDecisions: "Decisiones clave",
        blockers: "Bloqueos",
        noBlockers: "Sin bloqueos reportados",
        overviewOneProjectHint:
            '"Esta semana la actividad se concentró en el proyecto Authorization..."',
        writeInLang: "Write everything in Spanish.",
        progressInstruction:
            "(Agrupa tareas relacionadas por feature/tema. Usa 3-5 bullets máximo. Cada bullet = un área de trabajo, no una tarea individual. Siempre agrega el sub-item de personas.)",
        keyDecisionsInstruction:
            "[Decisiones técnicas o de producto mencionadas en Slack o inferidas de las tareas]",
    },
    en: {
        langName: "English",
        closedTasks: "Closed tasks",
        progress: "Progress",
        keyDecisions: "Key decisions",
        blockers: "Blockers",
        noBlockers: "No blockers reported",
        overviewOneProjectHint: '"This week\'s activity focused on the Authorization project..."',
        writeInLang: "Write everything in English.",
        progressInstruction:
            "(Group related tasks by feature/theme. Use 3-5 bullet points max. Each bullet = one area of work, not one task. Always add the people sub-item.)",
        keyDecisionsInstruction:
            "[Technical or product decisions mentioned in Slack or implied by the tasks]",
    },
};

export function getLabels(lang: ReportLang): ReportLabels {
    return translations[lang];
}

/** Parse and validate the REPORT_LANG env var */
export const REPORT_LANG: ReportLang = (() => {
    const raw = (process.env.REPORT_LANG ?? "es").toLowerCase().trim();
    if (raw === "en" || raw === "es") return raw;
    return "es"; // default to Spanish
})();

// ─── Tone ─────────────────────────────────────────────────────────────

/**
 * DigestTone controls *how* the LLM writes the report.
 * - informal: casual, teammate-friendly (emojis, startup vibe)
 * - formal:   professional, client-facing (executive summary, no slang)
 */
export type DigestTone = "informal" | "formal";

export interface ToneInstructions {
    /** Description for the "Tone:" rule in the prompt */
    toneRule: string;
    /** Extra rules/guidelines appended to the prompt for this tone */
    extraRules: string;
    /** System message modifier (appended to system prompt) */
    systemSuffix: string;
}

const toneInstructions: Record<ReportLang, Record<DigestTone, ToneInstructions>> = {
    es: {
        informal: {
            toneRule: "informal pero profesional, como una startup tech",
            extraRules:
                "- Use emojis in section headings (✅, 🚀, 💡, 🚧).\n- Keep it friendly and direct. Short sentences, no corporate jargon.",
            systemSuffix: "",
        },
        formal: {
            toneRule:
                "formal y profesional, orientado a reportes ejecutivos para stakeholders o clientes",
            extraRules: [
                "- Do NOT use emojis anywhere in the report.",
                "- Use a polished, executive tone. Write as if presenting to a client or board member.",
                "- Replace emoji section markers (✅, 🚀, 💡, 🚧) with text labels (e.g. **Tareas cerradas:**, **Avances:**, etc.).",
                "- Avoid colloquialisms and slang. Keep sentences well-structured and professional.",
                "- The overview should read like an executive summary.",
            ].join("\n"),
            systemSuffix:
                " This report is intended for external stakeholders or clients. Maintain a formal, polished tone throughout.",
        },
    },
    en: {
        informal: {
            toneRule: "informal but professional, like a tech startup",
            extraRules:
                "- Use emojis in section headings (✅, 🚀, 💡, 🚧).\n- Keep it friendly and direct. Short sentences, no corporate jargon.",
            systemSuffix: "",
        },
        formal: {
            toneRule:
                "formal and professional, aimed at executive reports for stakeholders or clients",
            extraRules: [
                "- Do NOT use emojis anywhere in the report.",
                "- Use a polished, executive tone. Write as if presenting to a client or board member.",
                "- Replace emoji section markers (✅, 🚀, 💡, 🚧) with text labels (e.g. **Closed tasks:**, **Progress:**, etc.).",
                "- Avoid colloquialisms and slang. Keep sentences well-structured and professional.",
                "- The overview should read like an executive summary.",
            ].join("\n"),
            systemSuffix:
                " This report is intended for external stakeholders or clients. Maintain a formal, polished tone throughout.",
        },
    },
};

export function getToneInstructions(lang: ReportLang, tone: DigestTone): ToneInstructions {
    return toneInstructions[lang][tone];
}

/** Validate a raw string to DigestTone (defaults to "informal") */
export function parseTone(raw: string | undefined): DigestTone {
    const val = (raw ?? "informal").toLowerCase().trim();
    if (val === "formal" || val === "informal") return val;
    return "informal";
}
