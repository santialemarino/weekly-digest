/**
 * output/email.ts — Sends the digest via email using nodemailer.
 *
 * Env: OUTPUT_EMAIL_FORMAT     — format for the email body (default: "html").
 *      OUTPUT_EMAIL_TONE       — tone to use (default: "formal").
 *      OUTPUT_EMAIL_ATTACH_PDF — attach the PDF to the email (default: true).
 *
 * Required env vars when enabled:
 *   OUTPUT_EMAIL_TO        — comma-separated recipient emails
 *   OUTPUT_EMAIL_FROM      — sender address
 *   OUTPUT_EMAIL_SMTP_HOST — SMTP server host
 *   OUTPUT_EMAIL_SMTP_PORT — SMTP port (default: 587)
 *   OUTPUT_EMAIL_SMTP_USER — SMTP username
 *   OUTPUT_EMAIL_SMTP_PASS — SMTP password
 */

import nodemailer from "nodemailer";
import { parseTone, type DigestTone } from "../../config/i18n.js";
import logger from "../../config/logger.js";
import { resolveFormat, pickFormat, type TonedDigests } from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";

const EMAIL_TO = (process.env.OUTPUT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const SMTP_HOST = process.env.OUTPUT_EMAIL_SMTP_HOST ?? "";
const SMTP_PORT = parseInt(process.env.OUTPUT_EMAIL_SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.OUTPUT_EMAIL_SMTP_USER ?? "";
const SMTP_PASS = process.env.OUTPUT_EMAIL_SMTP_PASS ?? "";
const EMAIL_FROM = process.env.OUTPUT_EMAIL_FROM ?? "";

function getFormat() {
    return resolveFormat(process.env.OUTPUT_EMAIL_FORMAT ?? "html") ?? "html";
}

function getTone(): DigestTone {
    return parseTone(process.env.OUTPUT_EMAIL_TONE ?? "formal"); // default: formal for clients
}

function shouldAttachPdf(): boolean {
    const raw = (process.env.OUTPUT_EMAIL_ATTACH_PDF ?? "true").toLowerCase().trim();
    return ["true", "1", "yes"].includes(raw);
}

export function createEmailDriver(): OutputDriver {
    const tone = getTone();
    return {
        name: "email",
        tone,

        async send(digests: TonedDigests, meta: DigestMetadata): Promise<void> {
            if (EMAIL_TO.length === 0) {
                logger.warn("OUTPUT_EMAIL is enabled but OUTPUT_EMAIL_TO is empty — skipping");
                return;
            }

            if (!SMTP_HOST || !EMAIL_FROM) {
                logger.warn(
                    "OUTPUT_EMAIL is enabled but SMTP config is incomplete " +
                        "(need OUTPUT_EMAIL_SMTP_HOST and OUTPUT_EMAIL_FROM) — skipping"
                );
                return;
            }

            const subject =
                meta.reportType === "sprint"
                    ? `Sprint Report — ${meta.sprintPeriod ?? meta.date}`
                    : `Weekly Digest — ${meta.date}`;

            const fmt = getFormat();
            const digest = digests[tone]!;
            const transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: SMTP_PORT,
                secure: SMTP_PORT === 465,
                auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
            });

            try {
                const mailOptions: nodemailer.SendMailOptions = {
                    from: EMAIL_FROM,
                    to: EMAIL_TO.join(", "),
                    subject,
                };

                if (fmt === "html") {
                    mailOptions.html = digest.html;
                    mailOptions.text = digest.plainText;
                } else {
                    mailOptions.text = pickFormat(digest, fmt);
                }

                // Attach PDF if available and enabled
                if (shouldAttachPdf() && digest.pdf) {
                    mailOptions.attachments = [
                        {
                            filename: `digest_${meta.date}.pdf`,
                            content: digest.pdf,
                            contentType: "application/pdf",
                        },
                    ];
                }

                await transporter.sendMail(mailOptions);
                logger.info(
                    {
                        to: EMAIL_TO,
                        subject,
                        format: fmt,
                        tone,
                        pdfAttached: !!(shouldAttachPdf() && digest.pdf),
                    },
                    "Digest sent via email"
                );
            } catch (e) {
                logger.error({ err: e, to: EMAIL_TO }, "Failed to send email");
                throw e;
            }
        },
    };
}
