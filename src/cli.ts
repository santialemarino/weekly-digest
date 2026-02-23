/**
 * cli.ts — CLI entry point.
 *
 * Reads .env → builds config → calls runDigest() → dispatches outputs.
 * This is a thin wrapper around the core engine.
 */

import logger from "./config/logger.js";
import { buildConfigFromEnv } from "./config/env.js";
import { runDigest } from "./core.js";
import { dispatchOutputs } from "./services/output/index.js";

async function run(): Promise<void> {
    // 1. Build config from environment variables
    const { config, secrets } = await buildConfigFromEnv();

    // 2. Run the digest engine (fetch, generate, format)
    const { toned, metadata } = await runDigest(config, secrets);

    // 3. Dispatch to all configured outputs
    await dispatchOutputs(toned, metadata, config.outputs, secrets);
}

run().catch((e) => {
    logger.fatal({ err: e }, "Unhandled error");
    process.exit(1);
});
