/**
 * output/local-file.ts — Saves the digest locally in the selected formats.
 *
 * Env: OUTPUT_LOCAL_FILE_FORMATS — comma-separated list of formats to save.
 *      Default: "md,html,json,txt,pdf" (all formats).
 *      Options: md, html, json, txt (plain text), pdf
 *      OUTPUT_LOCAL_FILE_TONE — tone to save (default: "informal").
 *      Set to "all" to save every generated tone in separate sub-folders.
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseTone, type DigestTone } from "../../config/i18n.js";
import logger from "../../config/logger.js";
import {
    resolveFormat,
    pickFormat,
    isPdfFormat,
    FORMAT_EXTENSIONS,
    type DigestFormat,
    type FormattedDigest,
    type TonedDigests,
} from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(dirname(dirname(__filename))));

const ALL_TEXT_FORMATS: DigestFormat[] = ["markdown", "html", "json", "plainText"];

interface SelectedFormats {
    text: DigestFormat[];
    pdf: boolean;
}

function getSelectedFormats(): SelectedFormats {
    const raw = (process.env.OUTPUT_LOCAL_FILE_FORMATS ?? "").trim();
    if (!raw) return { text: ALL_TEXT_FORMATS, pdf: true };

    const text: DigestFormat[] = [];
    let pdf = false;

    for (const token of raw.split(",")) {
        if (isPdfFormat(token)) {
            pdf = true;
        } else {
            const resolved = resolveFormat(token);
            if (resolved && !text.includes(resolved)) {
                text.push(resolved);
            } else if (!resolved) {
                logger.warn({ token: token.trim() }, "Unknown local file format — ignored");
            }
        }
    }

    // If nothing valid was specified, default to all
    if (text.length === 0 && !pdf) return { text: ALL_TEXT_FORMATS, pdf: true };

    return { text, pdf };
}

/** Returns the configured tone, or "all" to save every available tone */
function getLocalTone(): DigestTone | "all" {
    const raw = (process.env.OUTPUT_LOCAL_FILE_TONE ?? "informal").toLowerCase().trim();
    if (raw === "all") return "all";
    return parseTone(raw);
}

function saveFormats(
    digest: FormattedDigest,
    basePath: string,
    formats: SelectedFormats
): string[] {
    const saved: string[] = [];

    for (const fmt of formats.text) {
        const path = `${basePath}.${FORMAT_EXTENSIONS[fmt]}`;
        writeFileSync(path, pickFormat(digest, fmt), "utf-8");
        saved.push(FORMAT_EXTENSIONS[fmt]);
    }

    if (formats.pdf && digest.pdf) {
        const path = `${basePath}.pdf`;
        writeFileSync(path, digest.pdf);
        saved.push("pdf");
    } else if (formats.pdf && !digest.pdf) {
        logger.debug("PDF requested but not available — skipped");
    }

    return saved;
}

export function createLocalFileDriver(): OutputDriver {
    const tonePref = getLocalTone();
    // For "needs tone" detection, default to informal (all tones are saved regardless)
    const tone: DigestTone = tonePref === "all" ? "informal" : tonePref;

    return {
        name: "local-file",
        tone,

        async send(digests: TonedDigests, meta: DigestMetadata): Promise<void> {
            const digestsDir = join(projectRoot, "digests");
            mkdirSync(digestsDir, { recursive: true });

            const formats = getSelectedFormats();
            const tones = Object.keys(digests) as DigestTone[];

            if (tonePref === "all") {
                // Save each tone in its own sub-folder
                for (const t of tones) {
                    const toneDir = join(digestsDir, t);
                    mkdirSync(toneDir, { recursive: true });
                    const base = join(toneDir, `digest_${meta.date}`);
                    const saved = saveFormats(digests[t]!, base, formats);
                    logger.info({ dir: toneDir, tone: t, formats: saved }, "Digest saved locally");
                }
            } else {
                // Save only the configured tone
                const digest = digests[tonePref] ?? digests[tones[0]!]!;
                const base = join(digestsDir, `digest_${meta.date}`);
                const saved = saveFormats(digest, base, formats);
                logger.info(
                    { dir: digestsDir, tone: tonePref, formats: saved },
                    "Digest saved locally"
                );
            }
        },
    };
}
