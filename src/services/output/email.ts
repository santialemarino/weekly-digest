/**
 * output/email.ts — Sends the digest via email using nodemailer.
 */

import nodemailer from "nodemailer";
import type { EmailOutputConfig, SmtpConfig } from "../../config/digest-config.js";
import logger from "../../config/logger.js";
import { pickFormat, type TonedDigests } from "../format/types.js";
import type { OutputDriver, DigestMetadata } from "./types.js";

export function createEmailDriver(config: EmailOutputConfig, smtp: SmtpConfig): OutputDriver {
    return {
        name: "email",
        tone: config.tone,

        async send(digests: TonedDigests, meta: DigestMetadata): Promise<void> {
            if (config.to.length === 0) {
                logger.warn("Email output enabled but no recipients configured — skipping");
                return;
            }

            if (!smtp.host || !config.from) {
                logger.warn(
                    "Email output enabled but SMTP config is incomplete " +
                        "(need smtp.host and from address) — skipping"
                );
                return;
            }

            const subject =
                meta.reportType === "sprint"
                    ? `Sprint Report — ${meta.sprintPeriod ?? meta.date}`
                    : `Weekly Digest — ${meta.date}`;

            const digest = digests[config.tone]!;
            const transporter = nodemailer.createTransport({
                host: smtp.host,
                port: smtp.port,
                secure: smtp.port === 465,
                auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
            });

            try {
                const mailOptions: nodemailer.SendMailOptions = {
                    from: config.from,
                    to: config.to.join(", "),
                    subject,
                };

                if (config.format === "html") {
                    mailOptions.html = digest.html;
                    mailOptions.text = digest.plainText;
                } else {
                    mailOptions.text = pickFormat(digest, config.format);
                }

                // Attach PDF if available and enabled
                if (config.attachPdf && digest.pdf) {
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
                        to: config.to,
                        subject,
                        format: config.format,
                        tone: config.tone,
                        pdfAttached: !!(config.attachPdf && digest.pdf),
                    },
                    "Digest sent via email"
                );
            } catch (e) {
                logger.error({ err: e, to: config.to }, "Failed to send email");
                throw e;
            }
        },
    };
}
