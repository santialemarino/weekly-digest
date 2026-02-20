/**
 * format/json.ts — Parses the markdown digest into structured JSON.
 *
 * Useful for programmatic consumption: dashboards, Notion integrations,
 * internal APIs, etc.
 *
 * The parser expects the known markdown structure produced by our Anthropic prompt:
 *   # Title
 *   Overview paragraph
 *   ---
 *   ## Project Name
 *   **Closed tasks:** N
 *   **Progress:** bullet list
 *   **Key decisions:** bullet list
 *   **Blockers:** text
 */

import type { DigestMetadata } from "../output/types.js";

interface ProjectSection {
    name: string;
    closedTasks: number;
    progress: string[];
    keyDecisions: string[];
    blockers: string[];
}

interface DigestJson {
    title: string;
    date: string;
    reportType: "weekly" | "sprint";
    sprintPeriod: string | null;
    overview: string;
    projects: ProjectSection[];
}

/** Parse a bullet list block: lines starting with "- " */
function parseBullets(lines: string[], startIdx: number): { items: string[]; endIdx: number } {
    const items: string[] = [];
    let i = startIdx;
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("- ")) {
            items.push(line.slice(2).trim());
        } else if (line.startsWith("  ") && items.length > 0) {
            // Sub-item → append to the last item
            items[items.length - 1] += ` ${line.trim()}`;
        } else if (line.trim() === "" || line.startsWith("---")) {
            i++;
            continue;
        } else {
            break;
        }
        i++;
    }
    return { items, endIdx: i };
}

export function toJson(markdown: string, meta: DigestMetadata): string {
    const lines = markdown.split("\n");

    // Extract title from first H1
    const titleLine = lines.find((l) => l.startsWith("# "));
    const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Digest";

    // Extract overview: everything between the title and the first ---
    const titleIdx = lines.indexOf(titleLine ?? "");
    const overviewLines: string[] = [];
    for (let i = titleIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") break;
        if (lines[i].trim()) overviewLines.push(lines[i].trim());
    }
    const overview = overviewLines.join(" ");

    // Parse project sections (each starts with ## )
    const projects: ProjectSection[] = [];
    let i = 0;

    while (i < lines.length) {
        if (!lines[i].startsWith("## ")) {
            i++;
            continue;
        }

        const name = lines[i].replace(/^##\s+/, "").trim();
        const project: ProjectSection = {
            name,
            closedTasks: 0,
            progress: [],
            keyDecisions: [],
            blockers: [],
        };

        i++;

        // Scan the section until the next ## or end of file
        while (i < lines.length && !lines[i].startsWith("## ")) {
            const line = lines[i];

            // Closed tasks count
            const taskMatch = line.match(/closed\s*tasks[:\s]*(\d+)/i);
            if (taskMatch) {
                project.closedTasks = parseInt(taskMatch[1], 10);
                i++;
                continue;
            }

            // Progress / Avances section
            if (/progress|avances/i.test(line)) {
                i++;
                const { items, endIdx } = parseBullets(lines, i);
                project.progress = items;
                i = endIdx;
                continue;
            }

            // Key decisions / Decisiones
            if (/key\s*decisions|decisiones/i.test(line)) {
                i++;
                const { items, endIdx } = parseBullets(lines, i);
                project.keyDecisions = items;
                i = endIdx;
                continue;
            }

            // Blockers / Bloqueos
            if (/blockers|bloqueos/i.test(line)) {
                i++;
                // Could be a bullet list or a single line
                if (i < lines.length && lines[i].startsWith("- ")) {
                    const { items, endIdx } = parseBullets(lines, i);
                    project.blockers = items;
                    i = endIdx;
                } else {
                    // Single-line blocker text
                    while (
                        i < lines.length &&
                        lines[i].trim() !== "" &&
                        lines[i].trim() !== "---" &&
                        !lines[i].startsWith("## ")
                    ) {
                        project.blockers.push(lines[i].trim());
                        i++;
                    }
                }
                continue;
            }

            i++;
        }

        projects.push(project);
    }

    const result: DigestJson = {
        title,
        date: meta.date,
        reportType: meta.reportType,
        sprintPeriod: meta.sprintPeriod,
        overview,
        projects,
    };

    return JSON.stringify(result, null, 2);
}
