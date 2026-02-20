/**
 * format/pdf.ts — Converts the styled HTML digest into a PDF buffer.
 *
 * Uses puppeteer to launch a headless browser, render the HTML,
 * and export it as a PDF. Returns null if generation fails.
 */

import puppeteer from "puppeteer";
import logger from "../../config/logger.js";

export async function toPdf(html: string): Promise<Buffer | null> {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        await page.setContent(html, { waitUntil: "networkidle0" });

        const pdf = await page.pdf({
            format: "A4",
            margin: { top: "24px", right: "32px", bottom: "24px", left: "32px" },
            printBackground: true,
        });

        logger.debug({ bytes: pdf.byteLength }, "PDF generated");
        return Buffer.from(pdf);
    } catch (e) {
        logger.warn({ err: e }, "PDF generation failed — skipping PDF format");
        return null;
    } finally {
        if (browser) await browser.close();
    }
}
