/**
 * env.ts — Validates all required environment variables at startup.
 *
 * Imported once at the top of server.ts. If any required var is missing or
 * malformed the process exits immediately with a clear error — rather than
 * crashing mid-request with a cryptic "undefined" somewhere deep in the code.
 *
 * Env vars are loaded before this runs via --env-file in the dev/start scripts.
 */

import { z } from "zod/v4";

const envSchema = z.object({
    // Database
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // Third-party APIs
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
    CLICKUP_API_TOKEN: z.string().min(1, "CLICKUP_API_TOKEN is required"),

    // Server (optional with defaults)
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_HOST: z.string().default("0.0.0.0"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

    // SMTP (optional — only required when the email output driver is used)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
    console.error("Invalid environment variables:\n");
    for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
}

export const env = result.data;
