/**
 * format/index.ts — Format orchestrator.
 *
 * Takes the raw markdown from Anthropic and produces all format variants.
 * Text formats are always generated (cheap). PDF is generated only if enabled.
 *
 * Also provides `formatAllTones` which formats multiple tone variants,
 * generating only the tones that are actually requested.
 */

import logger from "../../config/logger.js";
import type { DigestTone } from "../../config/i18n.js";
import type { DigestMetadata } from "../output/types.js";
import type { FormattedDigest, TonedDigests } from "./types.js";
import { toHtml } from "./html.js";
import { toJson } from "./json.js";
import { toPlainText } from "./plain-text.js";
import { toPdf } from "./pdf.js";

export type { FormattedDigest, TonedDigests } from "./types.js";

export async function formatDigest(
    markdown: string,
    meta: DigestMetadata,
    pdfEnabled: boolean
): Promise<FormattedDigest> {
    logger.info("Formatting digest into all output formats");

    const html = toHtml(markdown);
    const json = toJson(markdown, meta);
    const plainText = toPlainText(markdown);

    // PDF: only if enabled (uses puppeteer / headless Chrome)
    let pdf: Buffer | null = null;
    if (pdfEnabled) {
        logger.info("Generating PDF...");
        pdf = await toPdf(html);
    } else {
        logger.debug("PDF generation disabled");
    }

    const result: FormattedDigest = { markdown, html, json, plainText, pdf };

    logger.info(
        {
            markdown: `${result.markdown.length} chars`,
            html: `${result.html.length} chars`,
            json: `${result.json.length} chars`,
            plainText: `${result.plainText.length} chars`,
            pdf: pdf ? `${pdf.byteLength} bytes` : "skipped",
        },
        "All formats generated"
    );

    return result;
}

/**
 * Format raw markdown outputs keyed by tone into TonedDigests.
 * Only the tones present in `rawByTone` are formatted.
 */
export async function formatAllTones(
    rawByTone: Partial<Record<DigestTone, string>>,
    meta: DigestMetadata,
    pdfEnabled: boolean
): Promise<TonedDigests> {
    const result: TonedDigests = {};
    const tones = Object.keys(rawByTone) as DigestTone[];

    for (const tone of tones) {
        const markdown = rawByTone[tone]!;
        logger.info({ tone }, "Formatting digest for tone");
        result[tone] = await formatDigest(markdown, meta, pdfEnabled);
    }

    return result;
}
