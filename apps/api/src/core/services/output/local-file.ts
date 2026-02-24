/**
 * output/local-file.ts — Saves the digest locally in the selected formats.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { DigestTone } from "../../config/i18n.js";
import type { LocalFileOutputConfig } from "../../config/digest-config.js";
import logger from "../../config/logger.js";
import {
    pickFormat,
    FORMAT_EXTENSIONS,
    type DigestFormat,
    type FormattedDigest,
    type TonedDigests,
} from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";

// process.cwd() is the package root (apps/api/) when run via pnpm/turbo.
// Override via LocalFileOutputConfig.outputDir if needed.
const defaultOutputRoot = process.cwd();

function saveFormats(
    digest: FormattedDigest,
    basePath: string,
    formats: DigestFormat[],
    includePdf: boolean
): string[] {
    const saved: string[] = [];

    for (const fmt of formats) {
        const path = `${basePath}.${FORMAT_EXTENSIONS[fmt]}`;
        writeFileSync(path, pickFormat(digest, fmt), "utf-8");
        saved.push(FORMAT_EXTENSIONS[fmt]);
    }

    if (includePdf && digest.pdf) {
        const path = `${basePath}.pdf`;
        writeFileSync(path, digest.pdf);
        saved.push("pdf");
    } else if (includePdf && !digest.pdf) {
        logger.debug("PDF requested but not available — skipped");
    }

    return saved;
}

export function createLocalFileDriver(config: LocalFileOutputConfig): OutputDriver {
    const tonePref = config.tone;
    // For "needs tone" detection, default to informal (all tones are saved regardless)
    const tone: DigestTone = tonePref === "all" ? "informal" : tonePref;

    return {
        name: "local-file",
        tone,

        async send(digests: TonedDigests, meta: DigestMetadata): Promise<void> {
            const digestsDir = config.outputDir ?? join(defaultOutputRoot, "digests");
            mkdirSync(digestsDir, { recursive: true });

            const tones = Object.keys(digests) as DigestTone[];

            if (tonePref === "all") {
                // Save each tone in its own sub-folder
                for (const t of tones) {
                    const toneDir = join(digestsDir, t);
                    mkdirSync(toneDir, { recursive: true });
                    const base = join(toneDir, `digest_${meta.date}`);
                    const saved = saveFormats(digests[t]!, base, config.formats, config.includePdf);
                    logger.info({ dir: toneDir, tone: t, formats: saved }, "Digest saved locally");
                }
            } else {
                // Save only the configured tone
                const digest = digests[tonePref] ?? digests[tones[0]!]!;
                const base = join(digestsDir, `digest_${meta.date}`);
                const saved = saveFormats(digest, base, config.formats, config.includePdf);
                logger.info(
                    { dir: digestsDir, tone: tonePref, formats: saved },
                    "Digest saved locally"
                );
            }
        },
    };
}
